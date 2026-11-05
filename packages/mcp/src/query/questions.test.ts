import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { loggedCall, questionLogSettings, questionsByGap, questionsPathFor, readQuestions, recordQuestion, type QuestionEntry } from './questions.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo', '.flowatlas');

/** Three writers this many lines each, rotating every few lines: the race the old rotation lost. */
const RACE_CALLS = 4000;
const RACE_BYTES = 2000;

const dirs: string[] = [];
const clients: Client[] = [];
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  for (const client of clients) await client.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the multi-repo fixture's output, so a log can be written beside it. */
const fixtureCopy = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-questions-'));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, 'questions.jsonl'), { force: true });
  return join(dir, 'graph.db');
};

const connect = async (dbPath: string) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath, toolsPollMs: 0 }).connect(serverSide);
  const client = new Client({ name: 'questions-test', version: '0' });
  await client.connect(clientSide);
  clients.push(client);
  return async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    return response.content[0]!.text;
  };
};

const entry = (over: Partial<QuestionEntry> = {}): QuestionEntry => ({
  at: '2026-11-05T00:00:00.000Z',
  via: 'mcp',
  tool: 'get_flow',
  ids: [],
  resolved: 'found',
  failed: false,
  rows: 1,
  chars: 10,
  stoppedBy: null,
  gaps: [],
  reasons: [],
  empty: false,
  stale: false,
  ms: 1,
  ...over,
});

describe('the question log (P235)', () => {
  it('is off unless the configuration or the environment turns it on', async () => {
    expect(questionLogSettings(undefined, {}).enabled).toBe(false);
    expect(questionLogSettings(undefined, { FLOWATLAS_LOG_QUESTIONS: '1' }).enabled).toBe(true);
    expect(questionLogSettings({ log: { questions: true, text: false } } as never, {}).enabled).toBe(true);
    const dbPath = fixtureCopy();
    const call = await connect(dbPath);
    await call('get_flow', { entry: 'POST /orders' });
    expect(existsSync(questionsPathFor(dbPath))).toBe(false);
  });

  it('keeps one line per tool call, and answers exactly as it does with the log off', async () => {
    const quiet = await connect(fixtureCopy());
    const before = await quiet('get_flow', { entry: 'POST /orders' });
    vi.stubEnv('FLOWATLAS_LOG_QUESTIONS', '1');
    const dbPath = fixtureCopy();
    const call = await connect(dbPath);
    expect(await call('get_flow', { entry: 'POST /orders' })).toBe(before);
    await call('who_calls', { symbol: 'no-such-thing-at-all' });
    await call('search', { query: 'orders' });
    const { entries, unreadable } = readQuestions(dbPath);
    expect(unreadable).toBe(0);
    expect(entries.map((line) => [line.via, line.tool])).toEqual([
      ['mcp', 'get_flow'],
      ['mcp', 'who_calls'],
      ['mcp', 'search'],
    ]);
    const [flow, missing, search] = entries as [QuestionEntry, QuestionEntry, QuestionEntry];
    expect(flow).toMatchObject({ ids: ['POST /orders'], resolved: 'found', failed: false, empty: false, chars: before.length });
    expect(flow.rows).toBeGreaterThan(0);
    expect(missing).toMatchObject({ ids: ['no-such-thing-at-all'], resolved: 'none', failed: true, rows: 0 });
    // A search's words are kept only when the configuration asks for them.
    expect(search.text).toBeUndefined();
  });

  it('names the gaps on the answer, by the ids doctor --unresolved and accept use', async () => {
    vi.stubEnv('FLOWATLAS_LOG_QUESTIONS', '1');
    const dbPath = fixtureCopy();
    const call = await connect(dbPath);
    await call('get_flow', { entry: 'POST /orders/pay', service: 'gateway' });
    const [pay] = readQuestions(dbPath).entries as [QuestionEntry];
    expect(pay.ids).toEqual(['POST /orders/pay', 'gateway']);
    expect(pay.gaps.length).toBeGreaterThan(0);
    expect(pay.gaps.every((gap) => gap.startsWith('gap:gateway|'))).toBe(true);
    expect(pay.reasons.length).toBeGreaterThan(0);
  });

  it('writes ids and counts, never an answer: the log is small and holds no source', async () => {
    vi.stubEnv('FLOWATLAS_LOG_QUESTIONS', '1');
    const dbPath = fixtureCopy();
    const call = await connect(dbPath);
    const answer = await call('get_source', { id: (JSON.parse(await call('list_entries')) as { entries: Array<{ id: string }> }).entries[0]!.id });
    const log = readFileSync(questionsPathFor(dbPath), 'utf8');
    expect(log.length).toBeLessThan(answer.length + 2000);
    expect(log).not.toContain('"source"');
  });

  it('moves the log aside past its size, keeping two files', () => {
    const dbPath = fixtureCopy();
    for (let index = 0; index < 30; index += 1) recordQuestion(dbPath, entry({ ms: index }), 1000);
    const { entries } = readQuestions(dbPath);
    expect(entries.length).toBeLessThan(30);
    expect(entries.length).toBeGreaterThan(3);
    expect(entries.map((line) => line.ms)).toEqual([...entries.map((line) => line.ms)].sort((a, b) => a - b));
    expect(existsSync(join(dbPath, '..', 'questions.1.jsonl'))).toBe(true);
  });

  it('keeps writing when several processes move the log aside at once, and never moves a fresh log over the older one', async () => {
    const dbPath = fixtureCopy();
    const dir = join(dbPath, '..');
    const child = join(dir, 'writer.mjs');
    const built = pathToFileURL(join(ROOT, 'packages', 'mcp', 'dist', 'query', 'questions.js')).href;
    writeFileSync(
      child,
      [
        `import { recordQuestion } from ${JSON.stringify(built)};`,
        `const line = ${JSON.stringify(entry())};`,
        'let refused = 0;',
        `for (let index = 0; index < ${RACE_CALLS}; index += 1) if (!recordQuestion(${JSON.stringify(dbPath)}, line, ${RACE_BYTES})) refused += 1;`,
        'process.stdout.write(String(refused));',
      ].join('\n'),
    );
    const run = (): Promise<string> =>
      new Promise((done, fail) => {
        execFile(process.execPath, [child], { encoding: 'utf8' }, (error, stdout) => (error === null ? done(stdout) : fail(error)));
      });
    expect(await Promise.all([run(), run(), run()])).toEqual(['0', '0', '0']);
    expect(statSync(join(dir, 'questions.1.jsonl')).size).toBeGreaterThan(RACE_BYTES);
    expect(readdirSync(dir).filter((name) => name.endsWith('.rotating'))).toEqual([]);
  });

  it('counts a line it cannot read and goes on', () => {
    const dbPath = fixtureCopy();
    writeFileSync(questionsPathFor(dbPath), `${JSON.stringify(entry())}\nnot json\n${JSON.stringify(entry({ gaps: ['gap:a', 'gap:b'] }))}\n`);
    const { entries, unreadable } = readQuestions(dbPath);
    expect([entries.length, unreadable]).toEqual([2, 1]);
    expect([...questionsByGap(entries)]).toEqual([
      ['gap:a', 1],
      ['gap:b', 1],
    ]);
  });

  it('logs the team graph beside the output, not inside pulled', () => {
    expect(questionsPathFor(join('out', 'pulled', 'graph.db'))).toBe(join('out', 'questions.jsonl'));
    expect(questionsPathFor(join('out', 'graph.db'))).toBe(join('out', 'questions.jsonl'));
  });

  // Last: a log found unwritable stays off for the rest of the process.
  it('answers when the log cannot be written, and says so once', async () => {
    const missing = join(fixtureCopy(), '..', 'no-such-dir', 'graph.db');
    expect(recordQuestion(missing, entry())).toBe(false);
    const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const log = { settings: { enabled: true, text: false, maxBytes: 1000 }, dbPath: missing, db: () => undefined };
      const call = { via: 'mcp' as const, tool: 'start_here', args: {} };
      expect(await loggedCall(log, call, () => ({ content: [{ type: 'text', text: '{}' }] }))).toEqual({ content: [{ type: 'text', text: '{}' }] });
      expect(await loggedCall(log, call, () => 'second')).toBe('second');
      expect(said).toHaveBeenCalledTimes(1);
      expect(String(said.mock.calls[0]?.[0])).toContain('questions are not logged for the rest of this run');
    } finally {
      said.mockRestore();
    }
  });

  it('has no way to send anything: the module imports no network code', () => {
    const source = readFileSync(join(import.meta.dirname, 'questions.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports).toEqual(['node:fs', 'node:path', '@flowatlas/core', '@flowatlas/linker']);
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
  });
});
