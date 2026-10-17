import { PROMPT_WALK, type PromptFailure } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOW_DEPTH, PLUMBING_FAN_IN } from '../query/flow.js';
import { describeForPrompt, PROMPT_LIMITS, type PromptSubject } from './describe.js';

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
  ...over,
});

const thrown = (over: Partial<PromptFailure> & Pick<PromptFailure, 'exception'>): PromptFailure => ({
  at: 'shop#S.a',
  source: 'throw',
  ...over,
});

describe('a chain written for a prompt, through the renderer core keeps (P97)', () => {
  it('names each step with its place, how it was reached and what it carries', () => {
    const text = describeForPrompt(subject());
    expect(text).toContain('# Way in: POST /carts');
    expect(text).toContain(
      '  - **CartsService.create** `shop#src/carts.service.ts:CartsService.create` — shop `src/carts.service.ts:8` — calls (static) — takes `type:shop#CreateCartDto`; returns `type:shop#CartDto`',
    );
    expect(text).toContain('- in: `type:shop#CreateCartDto`');
    expect(text).toContain('- out: `type:shop#CartDto`');
    expect(text).toContain('- `dynamic-http-url` at shop `src/carts.service.ts:20`: the address is built at run time.');
    expect(text).toContain('- `get_flow({entry: "entry:shop:http:POST:/carts"})`');
  });

  it('says how many steps it left out', () => {
    const text = describeForPrompt(subject({ stepsCut: 3 }), { ...PROMPT_LIMITS, maxSteps: 1 });
    expect(text).toContain('4 more step(s) not shown; ask get_flow with a higher maxNodes');
  });

  it('asks for more depth when depth is all that cut the chain (P92)', () => {
    const text = describeForPrompt(subject({ stepsCut: 3, stepsCutBy: 'depth' }));
    expect(text).toContain('3 more step(s) not shown; ask get_flow with a higher depth');
  });

  it('says so when nothing is open on the chain', () => {
    expect(describeForPrompt(subject({ gaps: [] }))).toContain('- none recorded on this chain');
  });

  it('leads with what the way in can fail with, one line per status and exception (P68, P87)', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      thrown({ status: 404, exception: 'NotFoundException', at: 'shop#src/carts.service.ts:CartsService.create', file: 'src/carts.service.ts', line: 9 + i }),
    );
    const text = describeForPrompt(
      subject({
        fails: [
          ...six,
          thrown({ status: 500, exception: 'CartLocked', assumed: true, declared: 423, file: 'src/s.ts', line: 3 }),
          thrown({ status: 500, exception: 'Error', assumed: true }),
          thrown({ exception: 'RpcException', at: 'shop#src/carts.service.ts:CartsService.create' }),
        ],
      }),
    );
    expect(text).toContain('## Can fail with 404 · 500? · RpcException');
    expect(text).toContain('- **404** `NotFoundException` — throw ×6, first at `src/carts.service.ts:9`');
    expect(text).toContain('- **500?** `CartLocked` — throw at `src/s.ts:3` — assumed: the class states 423 and nothing maps it');
    expect(text).toContain('- **500?** `Error` — throw at `shop#S.a` — assumed: no code on the path writes this status');
    expect(text).toContain('- **no status** `RpcException`');
    expect(text.indexOf('## Can fail with')).toBeLessThan(text.indexOf('## Steps'));
    // The step a failure is thrown in says so, each answer once.
    expect(text).toContain('returns `type:shop#CartDto` [throws 404 NotFoundException, RpcException]');
  });

  it('says where a step written out once already is, and a cycle for what it is (P92)', () => {
    const again = { depth: 3, id: 'shop#log.ts:Logger.log', label: 'Logger.log', type: 'ref', repeat: true };
    const text = describeForPrompt(
      subject({
        steps: [
          ...subject().steps,
          { ...again, seenAt: 'shop#src/carts.controller.ts:CartsController.create' },
          { ...again, id: 'shop#src/carts.service.ts:CartsService.create', label: 'CartsService.create' },
        ],
      }),
    );
    expect(text).toContain('    - **Logger.log** again — followed under `shop#src/carts.controller.ts:CartsController.create`');
    expect(text).toContain('    - `shop#src/carts.service.ts:CartsService.create` again (a cycle; not followed)');
  });

  it('caps the failure section and says how many were left out', () => {
    const fails = Array.from({ length: 15 }, (_, i) => thrown({ status: 400 + i, exception: `E${i}` }));
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
          thrown({
            exception: 'toHttpError',
            via: 'helper',
            chosenFrom: [
              { exception: 'UnauthorizedException', status: 401 },
              { exception: 'ForbiddenException', status: 403 },
              { exception: 'LockedAccountError', status: 423 },
            ],
            at: 'shop#src/carts.controller.ts:CartsController.create',
            file: 'src/carts.controller.ts',
            line: 15,
          }),
          thrown({ exception: 'reject', via: 'helper', family: 'auth', at: 'x', file: 'src/carts.controller.ts', line: 30 }),
          thrown({ exception: 'reject', via: 'helper', family: 'auth', at: 'x', file: 'src/carts.controller.ts', line: 31 }),
        ],
      }),
    );
    expect(text).toContain('## Can fail with 401 · 403 · 423 · reject');
    expect(text).toContain(
      '- **`toHttpError (401 | 403 | 423)`** — chosen at run time from `UnauthorizedException`, `ForbiddenException`, `LockedAccountError` — throw at `src/carts.controller.ts:15`',
    );
    expect(text).toContain(
      '- **`reject (no status)`** — refuses a check of who is asking; what the helper returns was not read — throw ×2, first at `src/carts.controller.ts:30`',
    );
  });
});

describe('the walk under a prompt', () => {
  it('is the one get_flow takes, by the bounds the page walks by too (P97)', () => {
    expect(PROMPT_WALK.depth).toBe(DEFAULT_FLOW_DEPTH);
    expect(PROMPT_WALK.plumbingFanIn).toBe(PLUMBING_FAN_IN);
  });
});
