/*
 * The action's run step end to end (P231): `run.mjs` with the inputs
 * action.yml defaults to, against a copy of the demo project, with the
 * flowatlas this checkout builds on the path.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
const SERVICES = ['gateway', 'orders', 'billing', 'web'];

/** Every input's default, read from action.yml, so the test runs what a workflow that names none gets. */
const defaultsOf = (yaml) => {
  const inputs = yaml.slice(yaml.indexOf('\ninputs:\n'), yaml.indexOf('\noutputs:\n'));
  const found = {};
  let name;
  for (const line of inputs.split('\n')) {
    const key = /^ {2}([\w-]+):$/.exec(line);
    if (key !== null) name = key[1];
    const value = /^ {4}default: (.*)$/.exec(line);
    if (value !== null && name !== undefined) found[name] = value[1].replace(/^'(.*)'$/, '$1');
  }
  return found;
};

// Beside the fixtures, as the command's own tests keep theirs, and its own, because it makes git repositories.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-action-'));
const project = join(scratch, 'project');
const config = join(project, 'flowatlas.config.json');

const git = (repo, ...args) => execFileSync('git', ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

/** run.mjs as the composite action runs it, its inputs the defaults over `inputs`. */
const runStep = (inputs = {}) => {
  const env = { ...process.env, PATH: `${join(scratch, 'bin')}${delimiter}${process.env.PATH}` };
  for (const [name, value] of Object.entries({ ...defaultsOf(readFileSync(join(ROOT, 'action', 'action.yml'), 'utf8')), token: 't', ...inputs })) {
    env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] = value;
  }
  const output = join(scratch, `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, '');
  const run = spawnSync(process.execPath, [join(ROOT, 'action', 'src', 'run.mjs')], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...env,
      FLOWATLAS_CONFIG: config,
      FLOWATLAS_BASE: 'HEAD',
      // A fork's pull request: the step decides not to comment, and nothing is asked of GitHub.
      GITHUB_EVENT_PATH: join(scratch, 'event.json'),
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: join(scratch, 'summary.md'),
    },
  });
  return { status: run.status, log: `${run.stdout}${run.stderr}`, outputs: readFileSync(output, 'utf8') };
};

before(() => {
  cpSync(join(FIXTURES, 'multi-repo'), project, {
    recursive: true,
    filter: (source) => !/[\\/](\.flowatlas|\.build-lock|expected[^\\/]*)$/.test(source),
  });
  for (const repo of SERVICES) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  mkdirSync(join(scratch, 'bin'));
  const shim = join(scratch, 'bin', 'flowatlas');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js')}" "$@"\n`);
  chmodSync(shim, 0o755);
  writeFileSync(join(scratch, 'event.json'), JSON.stringify({ pull_request: { number: 1, head: { repo: { full_name: 'someone/shop' } } } }));
});

after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('the run step, with the inputs it defaults to (P231)', () => {
  it('passes a pull request that changes nothing, its docs checked against the graph diff built', () => {
    // The demo project keeps three blocks stale on purpose: stale before the branch, they annotate and fail nothing.
    const run = runStep();
    assert.equal(run.status, 0, run.log);
    assert.doesNotMatch(run.log, /graph\.db not found/);
    assert.doesNotMatch(run.log, /docs check did not run/);
    assert.match(run.log, /^::warning file=docs\/architecture\.md,line=63,title=flowatlas docs::/m);
    assert.match(run.outputs, /^verdict=safe$/m);
    assert.match(run.outputs, /^stale-docs=0$/m);
    assert.match(readFileSync(join(scratch, 'summary.md'), 'utf8'), /^<!-- flowatlas:diff config=[0-9a-f]+ -->/);
  });

  it('annotates the blocks the branch made stale, read off the head graph, and fails on them when told to', () => {
    // The branch renames the route two blocks draw; the base still has it.
    const controller = join(project, 'orders', 'src', 'orders', 'orders.controller.ts');
    const was = readFileSync(controller, 'utf8');
    try {
      writeFileSync(controller, was.replace("@Get(':id')", "@Get(':id/summary')"));
      const told = runStep({ 'fail-on': 'stale-docs' });
      assert.equal(told.status, 1, told.log);
      assert.match(told.log, /^::warning file=docs\/architecture\.md,line=10,title=flowatlas docs::/m);
      assert.match(told.log, /^::error::this branch makes \d+ doc blocks? stale/m);
      assert.equal(runStep({ 'fail-on': '' }).status, 0);
    } finally {
      writeFileSync(controller, was);
    }
  });
});
