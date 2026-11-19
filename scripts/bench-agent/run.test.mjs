import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeProject } from './generate.mjs';
import { questionsFor } from './questions.mjs';
import { readClaims, renderReport } from './report.mjs';
import { main, readSessions } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  for (const name of ['FLOWATLAS_BENCH_CLAUDE', 'STAND_IN_ANSWERS', 'STAND_IN_COUNT', 'STAND_IN_LIMIT_AFTER']) delete process.env[name];
});
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-run-'));
  dirs.push(dir);
  return dir;
};

describe('the runner (P238), with a stand-in for the assistant', () => {
  const root = fresh();
  const work = join(root, 'work');
  const results = join(root, 'results');
  const said = [];
  const io = { say: (text) => said.push(text) };
  const quiet = (run) => run;
  const common = ['--seed', '5', '--resources', '3', '--pause', '0', '--work', work, '--results', results];

  // The answers the stand-in gives: every question right, so the scores show the marking reached the sessions.
  const { key } = writeProject(join(root, 'key-only'), { seed: 5, resources: 3 });
  const answers = Object.fromEntries(questionsFor(key).map((question) => [question.prompt, `ANSWER: ${JSON.stringify(question.expected)}`]));
  writeFileSync(join(root, 'answers.json'), JSON.stringify(answers));
  process.env['FLOWATLAS_BENCH_CLAUDE'] = join(HERE, 'test', 'stand-in-claude.mjs');
  process.env['STAND_IN_ANSWERS'] = join(root, 'answers.json');
  process.env['STAND_IN_COUNT'] = join(root, 'count');

  let pilot;
  it('stops at a usage limit, keeps what finished, and resumes from there', quiet(async () => {
    process.env['STAND_IN_LIMIT_AFTER'] = '5';
    const stopped = await main(['--pilot', ...common], io);
    assert.equal(stopped.done, false);
    assert.match(said.join(''), /stopped by a usage limit after 5 of 32 sessions/);
    pilot = stopped.dir;
    assert.equal(readSessions(pilot).length, 5);
    delete process.env['STAND_IN_LIMIT_AFTER'];
    const resumed = await main(['--resume', pilot, '--work', work], io);
    assert.equal(resumed.done, true);
    const sessions = readSessions(pilot);
    assert.equal(sessions.length, 32);
    assert.equal(new Set(sessions.map((session) => `${session.question}|${session.arm}`)).size, 32);
  }));

  it('records each session: the score, the tools, the graph server reached, the measures', quiet(async () => {
    const sessions = readSessions(pilot);
    assert.ok(sessions.every((session) => session.outcome === 'answered' && session.correct && session.model === 'stand-in-model'));
    const graph = sessions.filter((session) => session.arm === 'C' || session.arm === 'D');
    // Both graph arms' servers started from the configuration each was handed, and answered.
    assert.ok(graph.every((session) => session.flowatlasCalls === 1 && session.flowatlasAnswerChars > 0));
    assert.ok(sessions.filter((session) => session.arm === 'A' || session.arm === 'B').every((session) => session.flowatlasCalls === 0));
    assert.deepEqual(sessions[0].tokens, { input: 1000, output: 100, cacheRead: 500, cacheWrite: 0, total: 1600 });
    const run = JSON.parse(readFileSync(join(pilot, 'run.json'), 'utf8'));
    assert.equal(run.done, true);
    assert.equal(run.model, 'stand-in-model');
    const estimate = JSON.parse(readFileSync(join(pilot, 'estimate.json'), 'utf8'));
    assert.equal(estimate.sessions, 30 * 3 * 4);
    assert.equal(estimate.tokens, 360 * 1600);
  }));

  it('refuses a full run without --yes, and starts one after the pilot with it', quiet(async () => {
    assert.equal(await main(['--full', ...common], io), undefined);
    const full = await main(['--full', '--yes', '--reps', '1', '--arms', 'C', ...common], io);
    assert.equal(full.done, true);
    assert.equal(readSessions(full.dir).length, 30);
    assert.ok(!readFileSync(join(full.dir, 'run.json'), 'utf8').includes(tmpdir()));
    assert.equal(JSON.parse(readFileSync(join(full.dir, 'run.json'), 'utf8')).pilot, pilot.split(/[\\/]/).pop());
  }));

  it('refuses a full run with no pilot of the same seed', quiet(async () => {
    await assert.rejects(main(['--full', '--yes', ...common.map((arg) => (arg === '5' ? '6' : arg))], io), /no finished pilot/);
  }));

  it('reports every kind, every expectation, and where the graph did worse', () => {
    const sessions = readSessions(pilot).map((session) => (session.arm === 'D' && session.kind === 'settings' ? { ...session, score: 0, correct: false } : session));
    const run = JSON.parse(readFileSync(join(pilot, 'run.json'), 'utf8'));
    const claims = readClaims(readFileSync(join(HERE, 'expectations.md'), 'utf8'));
    assert.ok(claims.length >= 15);
    const report = renderReport({ run, sessions, claims, notes: { 'settings-object': 'it trusted the graph' }, dir: pilot });
    assert.match(report.text, /\| contract \|/);
    assert.match(report.text, /`settings: D <= A` held/);
    assert.match(report.text, /`dead: C > B` \*\*did not hold\*\*/);
    assert.deepEqual(report.worse.map((row) => [row.question, row.arm]), [['settings-object', 'D']]);
    assert.match(report.text, /settings-object\*\*, arm D: 0\.00 against A's 1\.00\. Why: it trusted the graph/);
    assert.ok(!existsSync(join(pilot, 'transcripts')));
  });
});
