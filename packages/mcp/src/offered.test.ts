import { describe, expect, it } from 'vitest';
import { offeredOnly, offeredText, type Offer } from './offered.js';
import type { ToolName } from './tool-needs.js';

/** Each symbol's file, line and service, as the graph would place it. */
const offer = (hidden: ToolName[], places: Record<string, [string, number, string]> = {}): Offer => ({
  hidden: new Set(hidden),
  noCode: 'the code is not served from a database alone',
  readAt: (symbol, line) => {
    const place = places[symbol];
    return place === undefined ? undefined : `${place[0]}:${line ?? place[1]} in ${place[2]}`;
  },
});

describe('an answer names no tool the server hides (P360)', () => {
  it('leaves an answer as it is when nothing is hidden, or nothing hidden is named', () => {
    const answer = { next: ['get_flow({entry: "e"})'], note: 'use get_source' };
    expect(offeredOnly(answer, undefined)).toBe(answer);
    expect(offeredOnly(answer, offer([]))).toBe(answer);
    expect(offeredOnly({ next: ['get_flow({entry: "e"})'] }, offer(['check_rules']))).toEqual({ next: ['get_flow({entry: "e"})'] });
  });

  it('says where to read in place of a call that would have read code, and leaves out a call to any other hidden tool', () => {
    const scrubbed = offeredOnly(
      {
        next: [
          'who_calls({symbol: "orders#a.ts:A.run"})',
          'get_source({symbol: "orders#a.ts:A.run"})',
          'check_rules({rule: "edge-only"})',
          'get_source({symbol: "nowhere"})',
        ],
      },
      offer(['get_source', 'check_rules'], { 'orders#a.ts:A.run': ['src/a.ts', 12, 'orders'] }),
    );
    expect(scrubbed).toEqual({
      next: ['who_calls({symbol: "orders#a.ts:A.run"})', 'read src/a.ts:12 in orders: the code is not served from a database alone'],
    });
  });

  it('reads from the line a call asked for', () => {
    expect(
      offeredOnly(['get_source({symbol: "orders#a.ts:A.run", fromLine: 40})'], offer(['get_source'], { 'orders#a.ts:A.run': ['src/a.ts', 12, 'orders'] })),
    ).toEqual(['read src/a.ts:40 in orders: the code is not served from a database alone']);
  });

  it('drops a list emptied of calls, and keeps what start_here says about the hidden tools', () => {
    expect(offeredOnly({ rows: [], next: ['check_rules()'], hidden: 'check_rules: after rules[]' }, offer(['check_rules']))).toEqual({
      rows: [],
      hidden: 'check_rules: after rules[]',
    });
  });

  it('takes the part of a sentence that names a hidden tool out of it', () => {
    const hidden = offer(['get_source', 'check_rules', 'undeclared_failures']);
    expect(offeredOnly({ note: 'detail clamped to 2; use get_source' }, hidden)).toEqual({ note: 'detail clamped to 2' });
    expect(offeredText('- … 3 more; ask undeclared_failures for the rest', hidden)).toBe('- … 3 more');
    expect(offeredText('- entry: list_entries -> get_flow({entry: id}) -> get_source({symbol: id}) on the step that matters.', hidden)).toBe(
      '- entry: list_entries -> get_flow({entry: id}).',
    );
    expect(offeredText('A finding (check_rules lists those) is not a gap. Ask findings() for them.', hidden)).toBe(
      'A finding is not a gap. Ask findings() for them.',
    );
    expect(offeredText('Every answer is bounded; get_source is the only one that returns code.', hidden)).toBe('Every answer is bounded.');
    // A step that only led to the call taken out goes with it.
    expect(
      offeredText('- why: cant_follow groups them -> get_source on one; a wrapper of your own -> check_rules on a draft.', hidden),
    ).toBe('- why: cant_follow groups them.');
  });

  it('rewrites a Markdown text line by line, dropping a section left empty', () => {
    const markdown = [
      '# Way in',
      '',
      '## Gaps',
      '',
      '- none recorded on this chain',
      '- … 2 more; check_rules lists them all',
      '',
      '## Ask next',
      '',
      '- `check_rules({rule: "x"})`',
      '',
    ].join('\n');
    expect(offeredText(markdown, offer(['check_rules']))).toBe(['# Way in', '', '## Gaps', '', '- none recorded on this chain', '- … 2 more', ''].join('\n'));
    const read = offeredText('## Ask next\n\n- `get_source({symbol: "s"})`\n- `who_calls({symbol: "s"})`\n', offer(['get_source'], { s: ['src/s.ts', 3, 'shop'] }));
    expect(read).toBe('## Ask next\n\n- read src/s.ts:3 in shop: the code is not served from a database alone\n- `who_calls({symbol: "s"})`\n');
  });
});
