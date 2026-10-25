import { describe, expect, it } from 'vitest';
import { callOf, pagedNext, respond } from './common.js';

describe('respond', () => {
  it('writes one compact document, and the same document as structuredContent', () => {
    const answer = { entries: [{ id: 'entry:a', label: 'GET /a' }], total: 1, skipped: undefined };
    const reply = respond(answer);
    const text = reply.content[0]!.text;
    expect(text).toBe('{"entries":[{"id":"entry:a","label":"GET /a"}],"total":1}');
    expect(text).not.toMatch(/\n|": /);
    expect(reply.structuredContent).toEqual(JSON.parse(text));
    expect(Object.keys(reply.structuredContent!)).toEqual(['entries', 'total']);
    expect('isError' in reply).toBe(false);
  });

  it('says an error is one, and gives it no structuredContent to be checked as an answer', () => {
    const reply = respond({ error: 'no channel named "channel:x"' });
    expect(reply).toEqual({ content: [{ type: 'text', text: '{"error":"no channel named \\"channel:x\\""}' }], isError: true });
  });
});

describe('the call next writes for the next page', () => {
  it('leaves out what is at its default and keeps what was asked', () => {
    expect(callOf('list_entries', { service: 'orders', kind: undefined, detail: 1, maxNodes: 2, offset: 2 })).toBe(
      'list_entries({service: "orders", maxNodes: 2, offset: 2})',
    );
    expect(callOf('start_here', {})).toBe('start_here()');
  });

  it('comes first on a cut list, and not at all on the last page', () => {
    const hints = ['get_flow({entry: "a"})', 'describe_for_prompt({id: "a"})', 'impact({symbol: "a"})', 'x()'];
    expect(pagedNext({ tool: 'list_entries', args: { maxNodes: 2 }, nextOffset: 2 }, hints)).toEqual([
      'list_entries({maxNodes: 2, offset: 2})',
      ...hints.slice(0, 3),
    ]);
    expect(pagedNext({ tool: 'list_entries', args: { maxNodes: 2 }, nextOffset: undefined }, hints)).toEqual(hints);
  });
});
