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
    const text = describeForPrompt(subject({ stepsCut: 3 }), { maxSteps: 1, maxGaps: 10, maxChars: 8000 });
    expect(text).toContain('4 more step(s) not shown');
  });

  it('says so when nothing is open on the chain', () => {
    expect(describeForPrompt(subject({ gaps: [] }))).toContain('- none recorded on this chain');
  });
});
