import { describe, expect, it } from 'vitest';
import { nextFor } from '../query/next.js';
import { describeForPrompt, type PromptSubject } from './describe.js';

const subject = (over: Partial<PromptSubject> = {}): PromptSubject => ({
  id: 'entry:shop:http:POST:/carts',
  label: 'POST /carts',
  type: 'entry',
  kind: 'http',
  service: 'shop',
  loc: 'src/carts.controller.ts:12',
  steps: [
    {
      depth: 1,
      id: 'shop#src/carts.controller.ts:CartsController.create',
      label: 'CartsController.create',
      type: 'method',
      service: 'shop',
      loc: 'src/carts.controller.ts:13',
      via: { type: 'handles', confidence: 'static' },
    },
    {
      depth: 2,
      id: 'shop#src/carts.service.ts:CartsService.create',
      label: 'CartsService.create',
      type: 'method',
      service: 'shop',
      loc: 'src/carts.service.ts:8',
      via: { type: 'calls', confidence: 'static' },
      params: ['type:shop#CreateCartDto'],
      returns: 'type:shop#CartDto',
    },
  ],
  stepsCut: 0,
  gaps: [{ reason: 'dynamic-http-url', message: 'the address is built at run time', service: 'shop', loc: 'src/carts.service.ts:20' }],
  askNext: nextFor({ id: 'entry:shop:http:POST:/carts', type: 'entry' }),
  ...over,
});

describe('a chain written for a prompt', () => {
  it('names each step with its place, how it was reached and what it carries', () => {
    const text = describeForPrompt(subject());
    expect(text).toContain('# POST /carts');
    expect(text).toContain('  - **CartsService.create** `shop#src/carts.service.ts:CartsService.create` — shop `src/carts.service.ts:8` — calls (static) — takes `type:shop#CreateCartDto`; returns `type:shop#CartDto`');
    expect(text).toContain('- in: `type:shop#CreateCartDto`');
    expect(text).toContain('- out: `type:shop#CartDto`');
    expect(text).toContain('- `dynamic-http-url` at shop `src/carts.service.ts:20`: the address is built at run time.');
    expect(text).toContain('- `get_flow({entry: "entry:shop:http:POST:/carts"})`');
  });

  it('says how many steps it left out', () => {
    const text = describeForPrompt(subject({ stepsCut: 3 }), { maxSteps: 1, maxGaps: 10, maxFails: 12, maxChars: 8000 });
    expect(text).toContain('4 more step(s) not shown');
  });

  it('says so when nothing is open on the chain', () => {
    expect(describeForPrompt(subject({ gaps: [] }))).toContain('- none recorded on this chain');
  });

  it('leads with what the way in can fail with, one line per status and exception (P68, P87)', () => {
    const text = describeForPrompt(
      subject({
        fails: [
          {
            status: 404,
            exception: 'NotFoundException',
            sources: ['throw'],
            sites: 6,
            at: 'shop#src/carts.service.ts:CartsService.create',
            loc: 'src/carts.service.ts:9',
          },
          { status: 500, exception: 'CartLocked', assumed: true, declared: 423, sources: ['throw'], sites: 1, at: 'shop#S.a', loc: 'src/s.ts:3' },
          { status: 500, exception: 'Error', assumed: true, sources: ['throw'], sites: 1, at: 'shop#S.a' },
          { exception: 'RpcException', sources: ['throw'], sites: 1, at: 'shop#src/carts.service.ts:CartsService.create' },
        ],
      }),
    );
    expect(text).toContain('## Can fail with');
    expect(text).toContain('- **404** `NotFoundException` — throw ×6, first at `src/carts.service.ts:9`');
    expect(text).toContain('- **500?** `CartLocked` — throw at `src/s.ts:3` — assumed: the class states 423 and nothing maps it');
    expect(text).toContain('- **500?** `Error` — throw at `shop#S.a` — assumed: no code on the path writes this status');
    expect(text).toContain('- **no status** `RpcException`');
    expect(text.indexOf('## Can fail with')).toBeLessThan(text.indexOf('## Chain'));
  });

  it('caps the failure section and says how many were left out', () => {
    const fails = Array.from({ length: 15 }, (_, i) => ({
      status: 400 + i,
      exception: `E${i}`,
      sources: ['throw' as const],
      sites: 1,
      at: 'shop#S.a',
    }));
    const text = describeForPrompt(subject({ fails }));
    expect(text.split('\n').filter((line) => line.startsWith('- **4'))).toHaveLength(12);
    expect(text).toContain('- … 3 more; ask get_flow for the rest');
  });

  it('writes no failure section for a subject that has none', () => {
    expect(describeForPrompt(subject())).not.toContain('Can fail with');
  });
});

describe('a throw through a helper, written for a prompt (P90)', () => {
  it('names the helper with what it can choose, and the classes behind it', () => {
    const text = describeForPrompt(
      subject({
        fails: [
          {
            exception: 'toHttpError',
            via: 'helper',
            chosenFrom: [
              { exception: 'UnauthorizedException', status: 401 },
              { exception: 'ForbiddenException', status: 403 },
              { exception: 'LockedAccountError', status: 423 },
            ],
            sources: ['throw'],
            sites: 1,
            at: 'shop#src/carts.controller.ts:CartsController.create',
            loc: 'src/carts.controller.ts:15',
          },
          { exception: 'reject', via: 'helper', family: 'auth', sources: ['throw'], sites: 2, at: 'x', loc: 'src/carts.controller.ts:30' },
        ],
      }),
    );
    expect(text).toContain(
      '- **`toHttpError (401 | 403 | 423)`** — chosen at run time from `UnauthorizedException`, `ForbiddenException`, `LockedAccountError` — throw at `src/carts.controller.ts:15`',
    );
    expect(text).toContain(
      '- **`reject (no status)`** — refuses a check of who is asking; what the helper returns was not read — throw ×2, first at `src/carts.controller.ts:30`',
    );
  });
});
