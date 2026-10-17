import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { runPatternsExplain, runPatternsSuggest, runPatternsTest } from './patterns.js';
import { testPatternText } from '../patterns/test.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'house-patterns');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');
const BARE = join(FIXTURE, 'variants', 'no-patterns', 'flowatlas.config.json');
const AMBIGUOUS = join(FIXTURE, 'variants', 'ambiguous', 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };
const dirs: string[] = [];
const outOf = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `flowatlas-patterns-${name}-`));
  dirs.push(dir);
  return dir;
};

let bare: string;
let ambiguous: string;
let read: string;

beforeAll(async () => {
  bare = outOf('bare');
  ambiguous = outOf('ambiguous');
  read = outOf('read');
  await buildProject({ config: BARE, out: bare, cache: false });
  await buildProject({ config: AMBIGUOUS, out: ambiguous, cache: false });
  await buildProject({ config: CONFIG, out: read, cache: false });
}, 120_000);

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const graphOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'project-graph.json'), 'utf8')) as {
    nodes: Array<{ id: string; type: string; meta?: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string; type: string }>;
    unresolved: Array<{ reason: string; service?: string; symbol?: string; meta?: Record<string, unknown> }>;
  };

describe('the house patterns, built', () => {
  it('join the bus and the clients with the file listed, and leave the places unfollowed without it', () => {
    const withRules = graphOf(read);
    expect(withRules.edges.filter((edge) => edge.type === 'emits' || edge.type === 'consumes').map((edge) => edge.to.startsWith('channel:') ? edge.to : edge.from)).toEqual([
      'channel:book.added',
      'channel:book.added',
    ]);
    expect(withRules.nodes.filter((node) => node.meta?.['describedBy'] !== undefined).map((node) => `${node.type} ${String(node.meta?.['describedBy'])}`).sort()).toEqual([
      'consumer pattern:shop-bus-on',
      'http_out pattern:api-client-call',
      'producer pattern:shop-bus-emit',
      'producer pattern:shop-bus-emit',
      'ui_api_call pattern:storefront-send',
      'ui_api_call pattern:storefront-send',
    ]);
    expect(withRules.unresolved.some((row) => row.reason === 'call-dynamic-receiver' && row.service === 'catalog')).toBe(false);
    const without = graphOf(bare);
    expect(without.nodes.some((node) => node.type === 'producer' || node.type === 'http_out' || node.type === 'ui_api_call')).toBe(false);
    expect(without.unresolved.filter((row) => row.reason === 'call-dynamic-receiver').map((row) => row.service).sort()).toEqual(['catalog', 'stock']);
  });

  it('read neither of two rules on one call, refuse a rule that cannot be said, and name one that matches nothing', () => {
    const rows = graphOf(ambiguous).unresolved;
    expect(rows.filter((row) => row.reason === 'pattern-ambiguous')).toHaveLength(2);
    expect(rows.find((row) => row.reason === 'pattern-not-expressible')?.meta).toMatchObject({ rule: 'shop-bus-later', part: 'argument 0 of later()' });
    expect(rows.find((row) => row.reason === 'pattern-unmatched')?.symbol).toBe('shop-bus-flush');
    expect(graphOf(ambiguous).nodes.some((node) => node.meta?.['describedBy'] === 'pattern:shop-bus-later')).toBe(false);
    expect(graphOf(ambiguous).nodes.some((node) => node.type === 'producer')).toBe(false);
  });
});

describe('patterns test', () => {
  it("passes the file's own tests", async () => {
    const run = await runPatternsTest([], { config: CONFIG }, quiet);
    expect(run.exitCode).toBe(0);
    expect(run.report.total).toEqual({ rules: 4, refused: 0, tests: 7, failed: 0 });
    expect(run.text).toContain('$CHANNEL = \'book.added\'');
  });

  it('fails a wrong expectation with the holes shown, exit 1', async () => {
    const run = await runPatternsTest([join(FIXTURE, 'variants', 'wrong-expectation.yml')], { config: CONFIG }, quiet);
    expect(run.exitCode).toBe(1);
    expect(run.text).toContain('wanted channel book.removed; drew book.added');
    expect(run.text).toContain('holes  $BUS = bus; $CHANNEL = \'book.added\'; $PAYLOAD = book');
  });

  it('exits 2 on a rule that does not compile', async () => {
    const run = await runPatternsTest([join(FIXTURE, 'variants', 'ambiguous', 'second-bus.yml')], { config: CONFIG }, quiet);
    expect(run.exitCode).toBe(2);
    expect(run.text).toContain('refused  shop-bus-later');
  });

  it('runs the rules over a file of code with --sample', async () => {
    const run = await runPatternsTest([], { config: CONFIG, sample: join(FIXTURE, 'catalog', 'src', 'books', 'books.service.ts') }, quiet);
    expect(run.text).toContain('shop-bus-emit: 2 match(es)');
    expect(run.text).toContain('api-client-call: 1 match(es)');
  });
});

describe('patterns explain', () => {
  it('names how far each rule got at a place, and the first part that did not fit', () => {
    const { report } = runPatternsExplain('catalog/src/books/books.service.ts:20', { config: AMBIGUOUS, db: join(ambiguous, 'graph.db') }, quiet);
    const [call] = report.places[0]?.calls ?? [];
    expect(call?.receiverType).toBe('ApiClient');
    expect(call?.rules.find((rule) => rule.id === 'api-client-call')?.fits).toBe(true);
    expect(call?.rules.find((rule) => rule.id === 'shop-bus-emit')?.stoppedAt).toMatchObject({ part: 'method' });
    expect(call?.rules.find((rule) => rule.id === 'shop-bus-later')?.refused).toContain('a hole inside a callback');
  });

  it('refuses a place it cannot read', () => {
    expect(() => runPatternsExplain('nowhere', { config: CONFIG }, quiet)).toThrow(/not a place/);
  });
});

describe('patterns suggest', () => {
  it('proposes starters for the bus and the client from the places without the file', async () => {
    const { report } = await runPatternsSuggest({ config: BARE, db: join(bare, 'graph.db'), minSites: '1' }, quiet);
    expect(report.rules.map((rule) => [rule.id, rule.kind, rule.sites, rule.compiles])).toEqual([
      ['shop-bus-emit', 'publish', 2, true],
      ['api-client-call', 'http-request', 1, true],
      ['shop-bus-on', 'subscribe', 1, true],
    ]);
    expect(report.rules[0]?.yaml).toContain('channel: book.added');
  });

  it('leaves out a group below --min-sites', async () => {
    const { report } = await runPatternsSuggest({ config: BARE, db: join(bare, 'graph.db') }, quiet);
    expect(report.rules).toEqual([]);
    expect(report.below.map((group) => group.group)).toEqual(['ShopBus.emit', 'ApiClient.call', 'ShopBus.on']);
  });

  it('writes starters with --out, never into a repository it reads', async () => {
    const out = outOf('starters');
    const { report } = await runPatternsSuggest({ config: BARE, db: join(bare, 'graph.db'), minSites: '1', out }, quiet);
    expect(report.written).toHaveLength(3);
    expect(existsSync(join(out, 'shop-bus-emit.yml'))).toBe(true);
    expect(report.listPatterns).toBe(`${out}/*.yml`);
    await expect(
      runPatternsSuggest({ config: BARE, db: join(bare, 'graph.db'), minSites: '1', out: join(FIXTURE, 'catalog', 'patterns') }, quiet),
    ).rejects.toThrow(/inside the repository of catalog/);
  });
});

describe('the tester test_pattern runs', () => {
  it('gives the same answer as patterns test for the same rules', async () => {
    const yaml = readFileSync(join(FIXTURE, 'flowatlas-patterns', 'house.yml'), 'utf8');
    const cli = await runPatternsTest([], { config: CONFIG }, quiet);
    const mcp = await testPatternText({ yaml }, undefined);
    expect(mcp.rules.map((rule) => [rule.id, rule.tests.map((test) => test.pass)])).toEqual(
      cli.report.rules.map((rule) => [rule.id, rule.tests.map((test) => test.pass)]),
    );
    expect(mcp.rules.flatMap((rule) => rule.tests.map((test) => test.failures))).toEqual(
      cli.report.rules.flatMap((rule) => rule.tests.map((test) => [...test.failures])),
    );
  });

  it('answers a draft rule over code, refused with the part named', async () => {
    const answer = await testPatternText(
      { yaml: 'id: bus\nkind: publish\non: { receiverType: ShopBus }\npattern: "$B.emit({ topic: $T })"\nchannel: $T', code: "bus.emit({ topic: 'book.added' })" },
      undefined,
    );
    expect(answer.rules[0]?.code).toMatchObject({ drew: ['producer on channel:book.added'], holes: { $B: 'bus', $T: "'book.added'" } });
    const refused = await testPatternText({ yaml: '- id: x\n  kind: publish\n  pattern: "$B.emit($T)"\n  channel: $T' }, undefined);
    expect(refused.rules[0]?.refused?.part).toBe('on.receiverType');
  });
});
