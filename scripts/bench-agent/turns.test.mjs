import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, graphTool, readTranscript, renderTurns, turnTable } from './turns.mjs';

/** A transcript as Claude Code's stream prints it: each turn's calls, then their results. */
const transcript = (turns, answer = 'ANSWER: ["GatewayOrdersTicketsClient.close"]') => {
  const lines = [JSON.stringify({ type: 'system', subtype: 'init' })];
  turns.forEach((calls, index) => {
    lines.push(JSON.stringify({ type: 'assistant', message: { id: `m${index}`, content: calls.map((call, at) => ({ type: 'tool_use', id: `c${index}-${at}`, name: call.name, input: call.input ?? {} })) } }));
    lines.push(JSON.stringify({ type: 'user', message: { content: calls.map((call, at) => ({ type: 'tool_result', tool_use_id: `c${index}-${at}`, content: [{ type: 'text', text: call.result ?? '' }], ...(call.error ? { is_error: true } : {}) })) } }));
  });
  lines.push(JSON.stringify({ type: 'result', result: answer, num_turns: turns.length + 1 }));
  return readTranscript(lines);
};

describe('where a session’s turns went (P392)', () => {
  it('classifies every call: loading, a lookup first, the question’s call, a second one, a failure and a read after a complete answer', () => {
    const read = transcript([
      [{ name: 'ToolSearch', input: { query: 'select:mcp__flowatlas__who_calls' }, result: 'loaded' }],
      [{ name: 'Read', input: { file_path: '/w/.claude/skills/flowatlas/SKILL.md' }, result: '# flowatlas' }],
      [{ name: 'mcp__flowatlas__find_symbol', input: { query: 'close' }, result: '{"matches":[{"id":"gateway#x:GatewayOrdersTicketsClient.close"}]}' }],
      [{ name: 'mcp__flowatlas__who_calls', input: { symbol: 'Nope.close' }, result: '{"candidates":["A.close","B.close"]}' }],
      [{ name: 'mcp__flowatlas__findings', input: {}, result: '{"findings":[{"message":"GatewayOrdersTicketsClient.close sends POST /tickets/:param/close"}],"complete":true}' }],
      [
        { name: 'mcp__flowatlas__dead', input: { ids: ['x'] }, result: '{"verdicts":[]}' },
        { name: 'Grep', input: { pattern: 'close' }, result: 'gateway/src/clients/orders-tickets.client.ts: close(id' },
      ],
    ]);
    const measured = classify(read, ['GatewayOrdersTicketsClient.close']);
    assert.deepEqual(
      measured.detail.map((call) => call.kind),
      ['tool-search', 'skill', 'lookup-first', 'failed-call', 'question-call', 'second-graph-call', 'read-after-complete'],
    );
    assert.equal(measured.detail[3].note, 'candidates');
    assert.match(measured.detail[5].note, /^dead ids: \["x"\]/);
    assert.equal(measured.detail[6].note, 'pattern: "close"');
    assert.equal(measured.toolTurns, 6);
    assert.equal(measured.extraTurns, 5);
    assert.equal(measured.failedCalls, 1);
    // Loading is not judged; the candidates, dead and a grep that matched the method alone hold nothing the answer names.
    assert.equal(measured.wastedCalls, 3);
  });

  it('reads a terminal command as a graph call, an error as a failed one, and judges no waste without items', () => {
    const read = transcript([[{ name: 'Bash', input: { command: 'flowatlas impact "X.y" --format json' }, result: 'no symbol named X.y', error: true }], [{ name: 'Bash', input: { command: 'cd gateway && flowatlas findings --format json' }, result: '{"findings":[]}' }]], 'ANSWER: "no"');
    assert.equal(graphTool(read.calls[0]), 'flowatlas impact');
    assert.equal(graphTool({ name: 'Bash', input: { command: 'grep -rn flowatlas .' } }), undefined);
    const measured = classify(read, undefined);
    assert.deepEqual(measured.detail.map((call) => call.kind), ['failed-call', 'question-call']);
    assert.equal(measured.detail[0].note, 'nothing-matches');
    assert.equal(measured.wastedCalls, null);
  });

  it('tables a run per arm and kind, with the tool error rate and wasted calls', () => {
    const session = (arm, kinds, extra) => ({ arm, kind: 'find-the-bug', turnKinds: kinds, extraTurns: extra, calls: 4, failedCalls: kinds['failed-call'] ?? 0, wastedCalls: 1 });
    const rows = turnTable([session('D', { 'tool-search': 1, 'question-call': 1, 'failed-call': 1 }, 2), session('D', { 'question-call': 1 }, 0), session('A', { read: 4 }, 3), { arm: 'B', kind: 'dead' }]);
    assert.deepEqual(rows.map((row) => `${row.arm} ${row.kind}`), ['A find-the-bug', 'D find-the-bug']);
    const d = rows[1];
    assert.equal(d.extraTurns, 1);
    assert.equal(d.kinds['tool-search'], 0.5);
    assert.equal(d.errorRate, 0.125);
    const table = renderTurns(rows);
    assert.match(table, /\| D \| find-the-bug \| 2 \| 1 \| 0\.5 \|/);
    assert.match(table, /12\.5%/);
  });
});
