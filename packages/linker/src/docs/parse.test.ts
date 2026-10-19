import { describe, expect, it } from 'vitest';
import { closingMarker, parseDocs, readRecordedStep, recordStep, rewriteDocBlocks, type RecordedStep } from './blocks.js';

const page = [
  '# Orders',
  '',
  '<!-- flowatlas:flow id="POST /orders" view="sequence" depth="6" max-nodes="40" detail="2" service="shop" -->',
  'old content',
  '<!-- /flowatlas:flow fingerprint="f3a9c1d0"',
  '["enters","caller","shop","POST /orders"]',
  '["http_calls","shop","billing","POST /invoices","heuristic",["type:shop#Invoice"],"type:billing#InvoiceDto"]',
  '-->',
  '',
  'Creating goes through <!-- flowatlas:ref id="shop#src/orders.service.ts:OrdersService.create" -->`create`.',
  '',
  '<!-- flowatlas:channel id="order.created" -->',
  '<!-- /flowatlas:channel -->',
  '',
].join('\n');

describe('parseDocs (P120)', () => {
  it('reads blocks, their attributes, their fingerprint and the steps it covered', () => {
    const { blocks, problems } = parseDocs(page);
    expect(problems).toEqual([]);
    expect(blocks.map((block) => [block.kind, block.id, block.view, block.line, block.endLine])).toEqual([
      ['flow', 'POST /orders', 'sequence', 3, 5],
      ['ref', 'shop#src/orders.service.ts:OrdersService.create', undefined, 10, undefined],
      ['channel', 'order.created', 'steps', 12, 13],
    ]);
    const [flow, ref, channel] = blocks;
    expect(flow?.options).toEqual({ depth: 6, maxNodes: 40, detail: 2, service: 'shop' });
    expect(flow?.fingerprint).toBe('f3a9c1d0');
    expect(flow?.content).toBe('\nold content\n');
    expect(flow?.recorded).toEqual([
      { kind: 'enters', from: 'caller', to: 'shop', label: 'POST /orders', confidence: 'static' },
      {
        kind: 'http_calls',
        from: 'shop',
        to: 'billing',
        label: 'POST /invoices',
        confidence: 'heuristic',
        params: ['type:shop#Invoice'],
        returns: 'type:billing#InvoiceDto',
      },
    ]);
    expect(ref?.content).toBe('');
    // Never written: no fingerprint, so a check says it is changed until it is.
    expect(channel?.fingerprint).toBeUndefined();
    expect(channel?.recorded).toBeUndefined();
  });

  it('decodes entities in an id', () => {
    const { blocks } = parseDocs('<!-- flowatlas:ref id="a &quot;b&quot; &amp; c" -->');
    expect(blocks[0]?.id).toBe('a "b" & c');
  });

  it('reads markers in a fenced code block or a code span as text about markers', () => {
    const text = [
      'Write a block like this:',
      '',
      '```md',
      '<!-- flowatlas:flow id="POST /orders" -->',
      '<!-- /flowatlas:flow -->',
      '```',
      '',
      'or a mention like `<!-- flowatlas:ref id="x" -->`.',
      '',
      '~~~~',
      '<!-- flowatlas:flow id="GET /a" -->',
      '~~~',
      '~~~~',
    ].join('\n');
    expect(parseDocs(text)).toEqual({ blocks: [], problems: [] });
  });

  it('skips a block it cannot read, and says why (I3)', () => {
    const cases: Array<[string, string]> = [
      ['<!-- flowatlas:flow id="a" -->\n<!-- flowatlas:flow id="b" -->\n<!-- /flowatlas:flow -->', 'is not closed before the block at line 2 opens'],
      ['<!-- flowatlas:flow id="a" -->\ntext', 'never closed'],
      ['<!-- /flowatlas:flow -->', 'with no block open'],
      ['<!-- flowatlas:flow id="a" -->\n<!-- /flowatlas:channel -->', 'is closed by a channel marker'],
      ['<!-- flowatlas:widget id="a" -->', 'unknown block kind "widget"'],
      ['<!-- flowatlas:flow id="a" veiw="steps" -->\n<!-- /flowatlas:flow -->', 'unknown attribute "veiw"'],
      ['<!-- flowatlas:flow id="a" view="slides" -->\n<!-- /flowatlas:flow -->', 'unknown view "slides"'],
      ['<!-- flowatlas:flow id="a" depth="0" -->\n<!-- /flowatlas:flow -->', 'depth must be a whole number'],
      ['<!-- flowatlas:flow id="a" detail="3" -->\n<!-- /flowatlas:flow -->', 'detail must be 0, 1 or 2'],
      ['<!-- flowatlas:flow view="steps" -->\n<!-- /flowatlas:flow -->', 'without an id'],
      ['text <!-- flowatlas:flow id="a" -->\n<!-- /flowatlas:flow -->', 'must start its line'],
      ['<!-- flowatlas:ref id="a" view="steps" -->', 'unknown attribute "view" on a ref'],
      ['<!-- flowatlas:flow id="a" id="b" -->\n<!-- /flowatlas:flow -->', 'written twice'],
    ];
    for (const [text, said] of cases) {
      const { problems } = parseDocs(text);
      expect(problems.map((problem) => problem.message).join(' | '), text).toContain(said);
    }
    // The nested pair: the outer is skipped, the inner is read.
    const nested = parseDocs('<!-- flowatlas:flow id="a" -->\n<!-- flowatlas:flow id="b" -->\n<!-- /flowatlas:flow -->');
    expect(nested.blocks.map((block) => block.id)).toEqual(['b']);
    expect(nested.problems[0]?.line).toBe(1);
  });

  it('reads no steps from a marker whose steps cannot all be read', () => {
    const { blocks } = parseDocs('<!-- flowatlas:flow id="a" -->\n<!-- /flowatlas:flow fingerprint="x"\n["enters","caller","a","A"]\nnot json\n-->');
    expect(blocks[0]?.fingerprint).toBe('x');
    expect(blocks[0]?.recorded).toBeUndefined();
  });
});

describe('recorded steps', () => {
  it('round-trip, with no label able to end the comment', () => {
    const steps: RecordedStep[] = [
      { kind: 'emits', from: 'shop', to: 'channel:a-->b', label: 'a-->b <x>', confidence: 'static', params: ['type:shop#A'] },
      { kind: 'consumes', from: 'channel:a-->b', to: 'billing', label: 'a-->b', confidence: 'static', takes: ['type:billing#B'] },
      { kind: 'stop', from: 'billing', to: 'billing', label: 'call-dynamic-receiver', confidence: 'heuristic' },
    ];
    for (const step of steps) {
      const line = recordStep(step);
      expect(line).not.toContain('-->');
      expect(readRecordedStep(line)).toEqual(step);
    }
    const marker = closingMarker('flow', 'abcd1234', steps);
    const { blocks } = parseDocs(`<!-- flowatlas:flow id="a" -->\n${marker}`);
    expect(blocks[0]?.recorded).toEqual(steps);
  });
});

describe('rewriteDocBlocks', () => {
  it('writes only between the markers, and keeps CRLF', () => {
    const text = 'before\r\n<!-- flowatlas:flow id="a" -->\r\nold\r\n<!-- /flowatlas:flow -->\r\nafter <!-- flowatlas:ref id="b" -->\r\n';
    const { blocks } = parseDocs(text);
    const flow = blocks.find((block) => block.kind === 'flow');
    if (flow === undefined) throw new Error('no block');
    const ref = blocks.find((block) => block.kind === 'ref');
    if (ref === undefined) throw new Error('no ref');
    const out = rewriteDocBlocks(
      text,
      new Map([
        [flow, { content: 'new\nlines', fingerprint: '0000ffff', steps: [] }],
        [ref, { content: 'never', fingerprint: 'x', steps: [] }],
      ]),
    );
    expect(out).toBe('before\r\n<!-- flowatlas:flow id="a" -->\r\nnew\r\nlines\r\n<!-- /flowatlas:flow fingerprint="0000ffff" -->\r\nafter <!-- flowatlas:ref id="b" -->\r\n');
    // Read back, the same rewrite changes nothing.
    const again = parseDocs(out).blocks.find((block) => block.kind === 'flow');
    if (again === undefined) throw new Error('no block');
    expect(rewriteDocBlocks(out, new Map([[again, { content: 'new\nlines', fingerprint: '0000ffff', steps: [] }]]))).toBe(out);
  });
});
