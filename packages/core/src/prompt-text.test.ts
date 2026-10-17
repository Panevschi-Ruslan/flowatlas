import { describe, expect, it } from 'vitest';
import { FAILURE_SOURCES, groupFailures, type Failure } from './failures.js';
import {
  askNextOf,
  groupFails,
  PROMPT_FAIL_SOURCES,
  PROMPT_LIMITS,
  promptFit,
  renderPrompt,
  type PromptStep,
  type PromptSubject,
} from './prompt-text.js';

const step = (depth: number, name: string, over: Partial<PromptStep> = {}): PromptStep => ({
  depth,
  id: `shop#src/${name}.ts:${name}`,
  label: name,
  type: 'method',
  service: 'shop',
  loc: `src/${name}.ts:${depth * 10}`,
  via: { type: 'calls', confidence: 'static' },
  ...over,
});

const entry = (over: Partial<PromptSubject> = {}): PromptSubject => ({
  id: 'entry:shop:http:POST:/carts',
  label: 'POST /carts',
  type: 'entry',
  kind: 'http',
  service: 'shop',
  loc: 'src/carts.controller.ts:12',
  steps: [step(1, 'Carts.create', { via: { type: 'handles', confidence: 'static' } }), step(2, 'Store.save')],
  stepsCut: 0,
  gaps: [],
  ...over,
});

describe('one heading scheme for every subject (P97)', () => {
  it('heads a way in, a channel, a check and a symbol each by what it is, then its id line', () => {
    expect(renderPrompt(entry()).split('\n').slice(0, 3)).toEqual([
      '# Way in: POST /carts',
      '',
      '`entry:shop:http:POST:/carts` — entry / http in shop at `src/carts.controller.ts:12`',
    ]);
    const channel = renderPrompt({
      id: 'channel:cart.saved',
      label: 'cart.saved',
      type: 'channel',
      steps: [step(1, 'Worker.onSaved', { type: 'consumer', via: { type: 'consumes', confidence: 'static' } }), step(2, 'Mail.send')],
      stepsCut: 0,
      producers: [{ depth: 1, id: 'producer:shop#src/a.ts:3:1', label: 'emit cart.saved', type: 'producer' }],
      gaps: [],
    });
    expect(channel).toMatch(/^# Channel: cart\.saved/);
    expect(channel).toContain('## Published by · 1\n\n- **emit cart.saved** `producer:shop#src/a.ts:3:1`');
    expect(channel).toContain('## Consumed by · 1\n\n- **Worker.onSaved**');
    expect(channel).not.toContain('## Steps');
    const check = renderPrompt({
      id: 'gap:shop|src/a.ts|channel-dynamic',
      label: 'channel-dynamic',
      type: 'check',
      kind: 'action',
      service: 'shop',
      loc: 'src/a.ts',
      check: { places: [{ loc: 'src/a.ts:4', message: 'a name built at run time', hint: 'Annotate it.', on: step(1, 'Carts.create') }] },
      steps: [],
      stepsCut: 0,
      gaps: [],
    });
    expect(check).toMatch(/^# Check: channel-dynamic\n\n`gap:shop\|src\/a\.ts\|channel-dynamic` — check \/ action in shop at `src\/a\.ts`/);
    expect(check).toContain('## Where · 1\n\n- `src/a.ts:4`: a name built at run time (Annotate it.) — on **Carts.create** `shop#src/Carts.create.ts:Carts.create`');
    expect(check).not.toContain('## Gaps');
    expect(check).toContain('- `who_calls({symbol: "shop#src/Carts.create.ts:Carts.create"})`');
    expect(check).toContain('- `search({query: "src/a.ts", kinds: ["gaps"]})`');
    const symbol = renderPrompt({ ...entry(), id: 'shop#src/Store.ts:Store.save', label: 'Store.save', type: 'method', kind: undefined, reachedFrom: [{ depth: 1, id: 'entry:shop:http:POST:/carts', label: 'POST /carts', type: 'entry' }] });
    expect(symbol).toMatch(/^# Symbol: Store\.save/);
    expect(symbol).toContain('## Reached from\n\n- **POST /carts** `entry:shop:http:POST:/carts`');
  });

  it('says a page key for what it is, and asks nothing that needs the id', () => {
    const text = renderPrompt(entry({ id: 'k3x9', key: true, steps: [] }));
    expect(text).toContain("`k3x9` (the page's key for it) — entry / http");
    expect(text).not.toContain('## Ask next');
  });

  it('writes the schedule and the hits of a way in under its heading', () => {
    const text = renderPrompt(entry({ schedule: { expression: '0 3 * * *', zone: 'Europe/Paris' }, hits: 12 }));
    expect(text).toContain('- schedule: `0 3 * * *` in Europe/Paris\n- seen at run time: 12 hits');
  });

  it('says what stands in front of a way in, in words', () => {
    const text = renderPrompt(
      entry({
        access: {
          guards: [{ name: 'JwtAuthGuard', where: 'global', via: 'APP_GUARD in AuthModule', skippedBy: 'Public' }],
          optOuts: [{ decorator: 'Public', where: 'route', public: true, skips: 'JwtAuthGuard' }],
        },
      }),
    );
    expect(text).toContain('## In front of it\n\n- JwtAuthGuard · the whole application (APP_GUARD in AuthModule), switched off by @Public');
    expect(text).toContain('- @Public on this route, open on purpose; JwtAuthGuard reads it');
  });
});

describe('a step and its marks', () => {
  it('marks how sure the join is, when it runs, how often, what it throws, and what it logs', () => {
    const text = renderPrompt(
      entry({
        steps: [
          step(1, 'Carts.create', {
            via: { type: 'calls', confidence: 'heuristic', because: ['prefix'] },
            marks: { failure: true, together: true, perItem: 'for-of', nPlusOne: true, seen: 4 },
            logs: [{ level: 'warn', line: 14, text: 'retrying {id}' }, { level: 'error' }],
          }),
        ],
        fails: [{ status: 409, exception: 'Conflict', at: 'shop#src/Carts.create.ts:Carts.create', source: 'throw' }],
      }),
    );
    expect(text).toContain(
      '— calls (heuristic, because prefix) [best guess, on failure, side by side, per item (for-of), likely N+1, throws 409 Conflict, seen ×4]',
    );
    expect(text).toContain('  - logs warn `retrying {id}` at line 14\n  - logs error');
  });

  it('writes a channel’s first consumers and counts the rest', () => {
    const consumers = Array.from({ length: 6 }, (_, i) => step(1, `Worker${i}.on`, { via: { type: 'consumes', confidence: 'static' } }));
    const text = renderPrompt({ id: 'channel:c', label: 'c', type: 'channel', steps: consumers, stepsCut: 0, producers: [], gaps: [] });
    expect(text).toContain('## Consumed by · 6');
    expect(text).toContain('**Worker3.on**');
    expect(text).not.toContain('**Worker4.on**');
    expect(text).toContain('- … 2 more consumer(s); ask who_consumes');
    expect(text).toContain('- nothing found in the code publishes to it');
  });
});

describe('gaps', () => {
  it('keep the chain’s order, each node’s by line, and put a loop reached from more ways in first (P89)', () => {
    const text = renderPrompt(
      entry({
        gaps: [
          { reason: 'b', message: 'second', id: 'n1', loc: 'src/a.ts:20' },
          { reason: 'a', message: 'first', id: 'n1', loc: 'src/a.ts:3' },
          { reason: 'query-in-loop', message: 'loop one', id: 'n2', loc: 'src/b.ts:5', waysIn: 1 },
          { reason: 'query-in-loop', message: 'loop three', id: 'n3', loc: 'src/c.ts:5', waysIn: 3 },
        ],
      }),
    );
    const lines = text.split('\n').filter((line) => line.startsWith('- `'));
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
    expect(lines[2]).toContain('loop three. Reached from 3 ways in.');
    expect(lines[3]).toContain('loop one. Reached from 1 way in.');
  });
});

describe('bounded', () => {
  it('cuts whole lines to stay under the ceiling and says how many', () => {
    const steps = Array.from({ length: 30 }, (_, i) => step(1, `Step${i}.run`));
    const full = renderPrompt(entry({ steps }));
    const short = renderPrompt(entry({ steps }), { maxChars: 1200 });
    expect(short.length).toBeLessThanOrEqual(1200);
    expect(short).toMatch(/… \d+ more line\(s\) cut to stay under 1200 characters\n$/);
    const kept = short.split('\n').slice(0, -3);
    expect(full.startsWith(kept.join('\n'))).toBe(true);
    for (const line of kept) expect(full.split('\n')).toContain(line);
  });

  it('fits lines as they are, with nothing cut when they fit', () => {
    expect(promptFit(['a', 'b'], 1000)).toBe('a\nb\n');
  });

  it('caps the steps and asks for more by the limit that cut', () => {
    const steps = Array.from({ length: 50 }, (_, i) => step(1, `Step${i}.run`));
    const text = renderPrompt(entry({ steps, stepsCut: 2, stepsCutBy: 'depth' }), { ...PROMPT_LIMITS, maxChars: 40000 });
    expect(text).toContain('- … 12 more step(s) not shown; ask get_flow with a higher maxNodes');
  });
});

describe('the calls it ends with', () => {
  it('are the subject’s, then the first way in that reaches it, then the first step', () => {
    expect(askNextOf(entry())).toEqual([
      'get_flow({entry: "entry:shop:http:POST:/carts"})',
      'describe_for_prompt({id: "entry:shop:http:POST:/carts"})',
      'impact({symbol: "entry:shop:http:POST:/carts"})',
      'who_calls({symbol: "shop#src/Carts.create.ts:Carts.create"})',
    ]);
  });
});

describe('failures grouped once, for core and the page alike', () => {
  const fails: Failure[] = [
    { status: 404, exception: 'NotFound', at: 'a', source: 'throw' },
    { status: 404, exception: 'NotFound', at: 'b', source: 'guard', declared: 410 },
    { exception: 'pick', at: 'c', source: 'throw', via: 'helper', chosenFrom: [{ exception: 'Y', status: 403 }, { exception: 'X', status: 401 }] },
  ];

  it('is core’s groupFailures, one implementation', () => {
    expect(groupFailures(fails)).toEqual(groupFails(fails));
    expect([...PROMPT_FAIL_SOURCES]).toEqual([...FAILURE_SOURCES]);
    expect(groupFails(fails).map((group) => [group.status, group.exception, group.sites, group.sources])).toEqual([
      [404, 'NotFound', 2, ['throw', 'guard']],
      [undefined, 'pick', 1, ['throw']],
    ]);
    expect(groupFails(fails)[1]?.chosenFrom?.map((choice) => choice.status)).toEqual([401, 403]);
  });
});

/** A class, a file and a service written whole (P95). */
describe('scoped subjects', () => {
  const method = (name: string, steps: PromptStep[]) => ({
    id: `shop#src/carts.service.ts:Carts.${name}`,
    label: `Carts.${name}`,
    type: 'method',
    loc: 'src/carts.service.ts:5',
    reachedFrom: [step(1, 'POST /carts', { id: 'entry:shop:http:POST:/carts', type: 'entry' })],
    steps,
    stepsCut: 0,
  });
  const klass = (members: ReturnType<typeof method>[]): PromptSubject => ({
    id: 'shop#src/carts.service.ts:Carts',
    label: 'Carts',
    type: 'provider',
    kind: 'injectable',
    service: 'shop',
    scope: 'class',
    steps: [],
    stepsCut: 0,
    members,
    gaps: [],
  });

  it('heads a class, a file and a service by the scope, and ends with the calls that take it', () => {
    const text = renderPrompt(klass([method('add', [step(1, 'Store.save')])]));
    expect(text.split('\n')[0]).toBe('# Class: Carts');
    expect(text).toContain('## Methods · 1');
    expect(text).toContain('- **Carts.add** `shop#src/carts.service.ts:Carts.add` — `src/carts.service.ts:5` — reached from `entry:shop:http:POST:/carts`');
    expect(text).toContain('  - **Store.save**');
    // Not the text being written.
    expect(askNextOf(klass([]))).toEqual([
      'who_calls({symbol: "shop#src/carts.service.ts:Carts"})',
      'impact({symbol: "shop#src/carts.service.ts:Carts"})',
    ]);
    const file: PromptSubject = { id: 'shop#src/carts.service.ts', label: 'src/carts.service.ts', type: 'file', service: 'shop', scope: 'file', steps: [], stepsCut: 0, members: [], gaps: [] };
    expect(renderPrompt(file).split('\n')[0]).toBe('# File: src/carts.service.ts');
    expect(askNextOf(file)).toEqual(['search({query: "src/carts.service.ts", kinds: ["gaps"]})', 'cant_follow({service: "shop"})']);
    const service: PromptSubject = { id: 'shop', label: 'shop', type: 'service', scope: 'service', steps: [], stepsCut: 0, gaps: [] };
    expect(renderPrompt(service).split('\n')[0]).toBe('# Service: shop');
    expect(askNextOf(service)[0]).toBe('findings({service: "shop"})');
  });

  it('shares maxSteps among the methods in order, saying what each one left out', () => {
    const long = [1, 2, 3].map((n) => step(1, `S${n}`));
    const text = renderPrompt(klass([method('add', long), method('drop', long)]), { ...PROMPT_LIMITS, maxSteps: 4 });
    expect(text).toContain('  - **S3**');
    expect(text.match(/\*\*S\d\*\*/g)).toHaveLength(4);
    expect(text).toContain('  - … 2 more step(s) not shown; ask describe_for_prompt({id: "shop#src/carts.service.ts:Carts.drop"})');
  });
});
