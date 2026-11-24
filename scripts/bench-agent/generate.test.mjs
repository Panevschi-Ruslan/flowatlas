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

  it('plants each find-the-bug defect beside its twin, in the code and in the key (P392)', () => {
    const dir = fresh();
    const { key } = writeProject(dir, { seed: 3, resources: 4 });
    const read = (path) => readFileSync(join(dir, path), 'utf8');
    assert.deepEqual(key.defects.map((defect) => defect.id), ['renamed-route', 'renamed-field', 'renamed-message', 'shadowed-route', 'env-renamed', 'unguarded-write']);
    // The renamed route: the gateway posts to close, orders serves resolve; the twin matches.
    assert.match(read('gateway/src/clients/orders-tickets.client.ts'), /tickets\/\$\{id\}\/close/);
    const tickets = read('orders/src/tickets/tickets.controller.ts');
    assert.match(tickets, /@Post\(':id\/resolve'\)/);
    assert.ok(!tickets.includes("'close'") && !tickets.includes(':id/close'));
    // The literal after `:id`, and its twin before it.
    assert.ok(tickets.indexOf("@Get('summary')") < tickets.indexOf("@Get(':id')"));
    assert.ok(tickets.indexOf("@Get(':id')") < tickets.indexOf("@Get('overdue')"));
    // The event renamed on the publishing side.
    assert.match(read('orders/src/tickets/tickets.service.ts'), /emit\('ticket\.resolved'/);
    assert.match(read('shipping/src/events/ticket.events.ts'), /@EventPattern\('ticket\.closed'\)/);
    // The body field sent as cause and read as reason; the note's text matches.
    assert.match(read('gateway/src/clients/shipping-claims.client.ts'), /cause: body\.reason/);
    assert.match(read('shipping/src/claims/claims.controller.ts'), /reason: body\.reason/);
    // The one write of its controller with no guard, and a controller guarded as a whole.
    const claims = read('shipping/src/claims/claims.controller.ts');
    assert.equal((claims.match(/@UseGuards\(StaffGuard\)/g) ?? []).length, 2);
    assert.match(read('shipping/src/claims/claim-refunds.controller.ts'), /@UseGuards\(StaffGuard\)\n@Controller/);
    // The setting renamed in the deployment only.
    assert.match(read('billing/src/settings.ts'), /process\.env\.LEDGER_REGION as string/);
    assert.match(read('billing/docker-compose.yml'), /LEDGER_ZONE/);
    assert.ok(!read('billing/docker-compose.yml').includes('LEDGER_REGION'));
    // Every class the defects name is registered where its module is.
    assert.match(read('orders/src/app.module.ts'), /OrdersTicketsController/);
    assert.match(read('gateway/src/app.module.ts'), /GatewayShippingClaimsClient/);
    assert.equal((read('shipping/src/app.module.ts').match(/import \{ ShippingTicketEvents \}/g) ?? []).length, 1);
    // The planted routes are marked, so the earlier questions keep their subjects.
    assert.ok(key.routes.filter((route) => route.path.startsWith('/tickets')).every((route) => route.planted === true));
  });

  it('answers every question from the key, and the pilot is two of each group', () => {
    const key = buildModel({ seed: 1 });
    const { key: written } = writeProject(fresh(), { seed: 1 });
    const questions = questionsFor(written);
    assert.equal(questions.length, readTemplates().length);
    assert.ok(questions.length >= 42);
    assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
    const pilot = questions.filter((question) => question.pilot);
    assert.equal(pilot.length, 8);
    const groups = new Map();
    for (const question of pilot) groups.set(question.group, (groups.get(question.group) ?? 0) + 1);
    assert.deepEqual([...groups.values()], [2, 2, 2, 2]);
    // Every kind the ticket names is asked, including the ones the graph should not help with.
    assert.deepEqual(
      [...new Set(questions.map((question) => question.kind))].sort(),
      ['blast-radius', 'change-files', 'code-text', 'contract', 'cross-repo-callers', 'dead', 'event-handlers', 'explain', 'find-the-bug', 'navigation', 'settings', 'single-repo'],
    );
    // Every find-the-bug question has its twins and says what it takes to see the defect (P392).
    for (const question of questions.filter((each) => each.kind === 'find-the-bug')) {
      assert.ok(question.decoys.length > 0, question.id);
      assert.ok(['repository', 'across'].includes(question.context), question.id);
      assert.ok(question.decoys.every((decoy) => !question.expected.includes(decoy)), question.id);
    }
    // A change task's files are named with their repository, and touch more than one.
    for (const question of questions.filter((each) => each.kind === 'change-files')) assert.ok(new Set(question.expected.map((path) => path.split('/')[0])).size > 1, question.id);
    assert.equal(key.seed, 1);
  });
});
