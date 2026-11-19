import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, it } from 'node:test';
import { writeProject } from './generate.mjs';
import { buildModel } from './model.mjs';
import { questionsFor, readTemplates } from './questions.mjs';

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-agent-'));
  dirs.push(dir);
  return dir;
};

/** Every file under a directory with its text, by path. */
const tree = (dir) => {
  const out = new Map();
  const visit = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) visit(path);
      else out.set(relative(dir, path), readFileSync(path, 'utf8'));
    }
  };
  visit(dir);
  return out;
};

describe('the benchmark project (P238)', () => {
  it('is the same project and the same key from the same seed', () => {
    const one = fresh();
    const two = fresh();
    writeProject(one, { seed: 7, resources: 3 });
    writeProject(two, { seed: 7, resources: 3 });
    assert.deepEqual(tree(one), tree(two));
    const other = fresh();
    writeProject(other, { seed: 8, resources: 3 });
    assert.notEqual(readFileSync(join(one, 'key.json'), 'utf8'), readFileSync(join(other, 'key.json'), 'utf8'));
  });

  it('has every trap, in the code and in the key', () => {
    const dir = fresh();
    const { key } = writeProject(dir, { seed: 3, resources: 4 });
    // A route nothing calls, and an event nothing handles.
    assert.ok(key.routes.some((route) => route.callers.length === 0));
    const unheard = key.events.find((event) => event.name === key.traps.unheard);
    assert.deepEqual(unheard.consumers, []);
    const files = tree(dir);
    assert.ok([...files.values()].some((text) => text.includes(`this.events.emit('${unheard.name}'`)));
    assert.ok(![...files.values()].some((text) => text.includes(`@EventPattern('${unheard.name}')`)));
    // The helper and the settings object, in the gateway's clients.
    const helper = readFileSync(join(dir, 'gateway', key.traps.helper), 'utf8');
    assert.match(helper, /return forward</);
    const settings = readFileSync(join(dir, 'gateway', key.traps.settings), 'utf8');
    assert.match(settings, /settings\.\w+Base/);
    // The renamed field: sent as qty, read as quantity.
    const renamed = key.fields.find((field) => field.route === key.traps.renamed);
    assert.deepEqual(renamed.sent, ['name', 'qty']);
    const client = [...tree(join(dir, 'gateway'))].find(([path, text]) => path.endsWith('.client.ts') && text.includes(`class ${renamed.caller.split('.')[0]} `));
    assert.match(client[1], /qty: body\.quantity/);
  });

  it('answers every question from the key, and the pilot is two of each group', () => {
    const key = buildModel({ seed: 1 });
    const { key: written } = writeProject(fresh(), { seed: 1 });
    const questions = questionsFor(written);
    assert.equal(questions.length, readTemplates().length);
    assert.ok(questions.length >= 30);
    assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
    const pilot = questions.filter((question) => question.pilot);
    assert.equal(pilot.length, 8);
    const groups = new Map();
    for (const question of pilot) groups.set(question.group, (groups.get(question.group) ?? 0) + 1);
    assert.deepEqual([...groups.values()], [2, 2, 2, 2]);
    // Every kind the ticket names is asked, including the ones the graph should not help with.
    assert.deepEqual(
      [...new Set(questions.map((question) => question.kind))].sort(),
      ['blast-radius', 'code-text', 'contract', 'cross-repo-callers', 'dead', 'event-handlers', 'explain', 'settings', 'single-repo'],
    );
    assert.equal(key.seed, 1);
  });
});
