import { existsSync, rmSync } from 'node:fs';
import { questionsPathFor, readQuestions, recordQuestion, type QuestionEntry } from '@flowatlas/mcp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryIo } from '../query/answer.js';
import { sinceOf, summariseQuestions } from '../report/questions.js';
import { buildTestProject } from '../test-graph.js';
import { runCantFollowCommand } from './doctor.js';
import { runExplain } from './explain.js';
import { runFlow } from './flow.js';
import { runImpact } from './impact.js';
import { runPath } from './path.js';
import { runStats } from './stats.js';

let dbPath: string;

beforeAll(() => {
  dbPath = buildTestProject('questions').dbPath;
});
beforeEach(() => {
  rmSync(questionsPathFor(dbPath), { force: true });
  rmSync(questionsPathFor(dbPath).replace('questions.jsonl', 'questions.1.jsonl'), { force: true });
});
afterEach(() => vi.unstubAllEnvs());

interface Capture extends QueryIo {
  stdout: string;
  stderr: string;
}

const capture = (): Capture => {
  const held = {
    stdout: '',
    stderr: '',
    tty: false,
    out(text: string) {
      held.stdout += text;
    },
    err(text: string) {
      held.stderr += text;
    },
  };
  return held;
};

const swallow = (run: () => unknown): void => {
  try {
    run();
  } catch {
    // The command's own stop; what matters here is what was logged.
  }
};

const ENTRY = 'entry:gateway:http:POST:/orders';
const TABLE = 'table:billing#Invoice';

const entry = (over: Partial<QuestionEntry>): QuestionEntry => ({
  at: '2026-11-05T10:00:00.000Z',
  via: 'mcp',
  tool: 'get_flow',
  ids: [],
  resolved: 'found',
  failed: false,
  rows: 1,
  chars: 100,
  stoppedBy: null,
  gaps: [],
  reasons: [],
  empty: false,
  stale: false,
  ms: 5,
  ...over,
});

describe('the asking commands log as the tools do (P235)', () => {
  it('log nothing while the log is off', () => {
    runFlow(ENTRY, { db: dbPath, format: 'json' }, capture());
    expect(existsSync(questionsPathFor(dbPath))).toBe(false);
  });

  it('log flow, impact, path and explain, and the names that matched nothing', () => {
    vi.stubEnv('FLOWATLAS_LOG_QUESTIONS', '1');
    const io = capture();
    runFlow(ENTRY, { db: dbPath, format: 'json' }, io);
    runPath(ENTRY, TABLE, { db: dbPath, format: 'json' }, capture());
    swallow(() => runImpact('NoSuchClass.method', { db: dbPath }, capture()));
    runExplain(ENTRY, { db: dbPath }, capture());
    const { entries } = readQuestions(dbPath);
    expect(entries.map((line) => [line.via, line.tool, line.resolved])).toEqual([
      ['cli', 'flow', 'found'],
      ['cli', 'path', 'found'],
      ['cli', 'impact', 'none'],
      ['cli', 'explain', 'found'],
    ]);
    const [flow, path, impact] = entries as [QuestionEntry, QuestionEntry, QuestionEntry];
    expect(flow).toMatchObject({ ids: [ENTRY], chars: io.stdout.length, failed: false, empty: false });
    expect(path.ids).toEqual([ENTRY, TABLE]);
    // The test project records a gap on that way, and the line names it by the id accept takes.
    expect(path.gaps).toEqual(['gap:gateway|src/clients/payments.client.ts|unknown-base-url-env']);
    expect(impact).toMatchObject({ ids: ['NoSuchClass.method'], failed: true, rows: 0, chars: 0 });
  });

  it('summarise in stats --questions: by tool, the names not found, the gaps asked about', () => {
    vi.stubEnv('FLOWATLAS_LOG_QUESTIONS', '1');
    runPath(ENTRY, TABLE, { db: dbPath, format: 'json' }, capture());
    swallow(() => runImpact('NoSuchClass.method', { db: dbPath }, capture()));
    swallow(() => runImpact('NoSuchClass.method', { db: dbPath }, capture()));
    const io = capture();
    runStats({ db: dbPath, questions: true, format: 'json' }, io);
    const summary = JSON.parse(io.stdout);
    expect(summary.questions).toBe(3);
    expect(summary.tools.map((tool: { tool: string; asked: number; unresolved: number }) => [tool.tool, tool.asked, tool.unresolved])).toEqual([
      ['impact', 2, 2],
      ['path', 1, 0],
    ]);
    expect(summary.unresolved).toEqual([{ name: 'NoSuchClass.method', asked: 2 }]);
    expect(summary.gaps).toEqual([
      {
        gap: 'gap:gateway|src/clients/payments.client.ts|unknown-base-url-env',
        reason: 'unknown-base-url-env',
        asked: 1,
        fixed: false,
        see: 'flowatlas doctor --unresolved --reason unknown-base-url-env',
      },
    ]);
    const text = capture();
    runStats({ db: dbPath, questions: true, format: 'tree' }, text);
    expect(text.stdout).toContain('impact: 2 · 0 · 0 · 2 (100%)');
    expect(text.stdout).toContain('NoSuchClass.method: 2');
  });

  it('says how to turn the log on when there is none', () => {
    const io = capture();
    runStats({ db: dbPath, questions: true, format: 'tree' }, io);
    expect(io.stderr).toContain('the question log is off');
    expect(io.stdout).toBe('no questions logged in this span\n');
  });

  it('put the causes questions ran into first in doctor --unresolved', () => {
    const before = runCantFollowCommand({ db: dbPath, format: 'json' }, capture()).report;
    expect(before.causes.every((cause) => cause.asked === undefined)).toBe(true);
    const asked = 'gap:orders|src/orders/orders.service.ts|di-token-unknown';
    for (let index = 0; index < 3; index += 1) recordQuestion(dbPath, entry({ gaps: [asked] }));
    const { report, text } = runCantFollowCommand({ db: dbPath }, capture());
    expect(report.causes[0]?.reasons).toContain('di-token-unknown');
    expect(report.causes[0]?.asked).toBe(3);
    expect(report.questions).toBe(3);
    expect(text).toContain('ordered by how many of the 3 logged questions ran into each');
    expect(text).toContain('asked by 3 of 3');
  });
});

describe('stats --questions --since', () => {
  it('reads a date or a span back from now', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    expect(sinceOf('24h', now)?.toISOString()).toBe('2026-11-04T12:00:00.000Z');
    expect(sinceOf('2w', now)?.toISOString()).toBe('2026-10-22T12:00:00.000Z');
    expect(sinceOf('2026-11-01', now)?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(() => sinceOf('yesterday', now)).toThrow('--since must be a date or a span');
  });

  it('counts cuts by their limit, p95 times, and gaps the graph no longer has as fixed', () => {
    const summary = summariseQuestions(
      [
        ...Array.from({ length: 19 }, (_, index) => entry({ ms: index + 1, stoppedBy: index < 2 ? 'maxNodes' : null, gaps: ['gap:a|f|r'] })),
        entry({ ms: 500, stoppedBy: 'depth', stale: true, gaps: ['gap:b|f|r'] }),
      ],
      { current: new Set(['gap:a|f|r']) },
    );
    expect(summary.tools[0]).toMatchObject({ asked: 20, cut: 3, cutBy: { maxNodes: 2, depth: 1 }, medianMs: 10, p95Ms: 19, slowestMs: 500, stale: 1 });
    expect(summary.gaps.map((gap) => [gap.gap, gap.fixed])).toEqual([
      ['gap:a|f|r', false],
      ['gap:b|f|r', true],
    ]);
    expect(summary.stale).toBe(1);
  });

  it('keeps only the questions from then on', () => {
    const summary = summariseQuestions([entry({ at: '2026-10-01T00:00:00.000Z' }), entry({ at: '2026-11-05T00:00:00.000Z', tool: 'who_calls' })], {
      since: new Date('2026-11-01'),
    });
    expect(summary.questions).toBe(1);
    expect(summary.tools.map((tool) => tool.tool)).toEqual(['who_calls']);
  });
});
