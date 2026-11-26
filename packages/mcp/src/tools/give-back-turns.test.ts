import { describe, expect, it } from 'vitest';
import { compactAnswer } from '../compact.js';
import { INSTRUCTIONS } from '../server.js';
import { lastWithinChars, MAX_CODE_CHARS } from './source.js';

/**
 * P396: what P381 to P394 cost in turns and characters, given back. A
 * plain-text question goes to grep at once; compact rows leave out the facts
 * check_contract and findings read, how to confirm a maybe by hand, a list
 * row's relations by id, and where a declaration ends outside a flow and
 * impact; a whole source answer stops at a size and says the call for the rest.
 */
describe('give back the turns', () => {
  it('says text in code is a grep before the first question', () => {
    expect(INSTRUCTIONS.indexOf('is a grep')).toBeGreaterThan(0);
    expect(INSTRUCTIONS.indexOf('is a grep')).toBeLessThan(300);
  });

  const flowStep = {
    id: 'web#src/api.ts:Api.load',
    loc: 'src/api.ts:12',
    endLine: 30,
    meta: { answerRead: ['name', 'price'], answerUnread: [{ why: 'spread' }], headers: ['x-tenant'], sendsJson: true, statusChecks: [404], url: '/items' },
    confirm: { grep: 'load', repo: 'web' },
  };

  it('leaves the facts check_contract and findings read out of rows and tree steps, and confirm with them', () => {
    const answer = compactAnswer({ root: { ...flowStep, children: [] } }, { tool: 'get_flow' }) as { root: Record<string, unknown> };
    expect(answer.root).toEqual({ id: flowStep.id, line: '12-30', meta: { url: '/items' } });
  });

  it('keeps where a declaration ends only on a flow and impact', () => {
    const rows = { callers: [{ ...flowStep }] };
    const who = compactAnswer(rows, { tool: 'who_calls' }) as { callers: Array<Record<string, unknown>> };
    expect(who.callers[0]!['line']).toBe(12);
    expect(who.callers[0]!['endLine']).toBeUndefined();
    const impact = compactAnswer({ entries: [{ ...flowStep }] }, { tool: 'impact' }) as { entries: Array<Record<string, unknown>> };
    expect(impact.entries[0]!['line']).toBe('12-30');
  });

  it("leaves a list row's relations by id out, noted once", () => {
    const answer = compactAnswer(
      {
        consumers: [
          {
            id: 'consumer:web#src/feed.ts:Feed.open',
            meta: { client: 'EventSource', events: ['message'], handsOnTo: ['consumer:web#src/a.ts:A.on'], routes: ['entry:api:http:GET:/stream'] },
          },
        ],
      },
      { tool: 'who_consumes' },
    ) as unknown as { consumers: Array<{ meta: Record<string, unknown> }>; note: string };
    expect(answer.consumers[0]!.meta).toEqual({ client: 'EventSource', events: ['message'] });
    expect(answer.note).toContain('handsOnTo, routes');
  });

  it('cuts a window of code at the last whole line within the most characters an answer holds', () => {
    const lines = Array.from({ length: 400 }, (_, at) => `${'x'.repeat(39)}${at % 10}`);
    const last = lastWithinChars(lines, 0, 399);
    expect(last).toBeLessThan(399);
    expect(lines.slice(0, last + 1).join('\n').length).toBeLessThanOrEqual(MAX_CODE_CHARS);
    expect(lines.slice(0, last + 2).join('\n').length).toBeGreaterThan(MAX_CODE_CHARS);
    expect(lastWithinChars(lines, 0, 10)).toBe(10);
    // A line longer than the whole cap is still given, alone.
    expect(lastWithinChars(['y'.repeat(MAX_CODE_CHARS * 2), 'z'], 0, 1)).toBe(0);
  });
});
