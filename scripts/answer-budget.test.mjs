import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ceilingOf, followOn, listsOf, overBudget, parseCall, rowsByList, tokensOf, wrongIn } from './answer-budget-rules.mjs';

const tolerance = { ratio: 0.1, chars: 300 };

test('an answer may grow 10% or 300 characters past its budget, whichever is larger', () => {
  assert.equal(ceilingOf(1000, tolerance), 1300);
  assert.equal(ceilingOf(5000, tolerance), 5500);
  assert.equal(tokensOf(401), 101);
  assert.deepEqual(overBudget('q', { chars: 1300, calls: 1 }, { chars: 1000, calls: 1 }, tolerance).problems, []);
  assert.match(overBudget('q', { chars: 1301, calls: 1 }, { chars: 1000, calls: 1 }, tolerance).problems[0], /past its budget of 1000 \(at most 1300\)/);
  assert.match(overBudget('q', { chars: 900, calls: 2 }, { chars: 1000, calls: 1 }, tolerance).problems[0], /takes 2 calls/);
  assert.match(overBudget('q', { chars: 600, calls: 1 }, { chars: 1000, calls: 1 }, tolerance).notes[0], /well under/);
});

test('reads the rows of a list, a tree, a search by kind and several answers', () => {
  const tree = { root: { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }] } };
  assert.deepEqual([...rowsByList([tree], ['root']).get('root')].map((row) => row.id), ['a', 'b', 'c']);
  const search = { results: { messages: [{ id: 'm' }], routes: [{ id: 'r1' }, { id: 'r2' }] } };
  assert.deepEqual([...listsOf(search, ['results.*']).keys()], ['messages', 'routes']);
  const several = { answers: [{ matches: [{ id: 'x' }] }, { matches: [{ id: 'y' }] }] };
  assert.deepEqual(rowsByList([several], ['matches']).get('matches').map((row) => row.id), ['x', 'y']);
  const verdicts = { answers: [{ id: 'x', verdict: 'alive' }] };
  assert.deepEqual(rowsByList([verdicts], ['answers']).get('answers'), [{ id: 'x', verdict: 'alive' }]);
  // Pages of one question add up.
  assert.equal(rowsByList([{ entries: [{ id: 'p1' }] }, { entries: [{ id: 'p2' }] }], ['entries']).get('entries').length, 2);
});

test('fails an answer that lists what it must not, misses what it must, or says incomplete', () => {
  const answer = { entries: [{ id: 'route' }, { id: 'screen', reach: 'outside' }, { id: 'extra' }], complete: false };
  const result = { first: answer, lists: rowsByList([answer], ['entries']), measured: { complete: false, calls: 1 } };
  const wrong = wrongIn(
    {
      complete: true,
      lists: { entries: ['route', 'bot'] },
      notListed: { entries: ['extra'] },
      rowsSay: { entries: { screen: { reach: 'alive' } } },
      exact: ['entries'],
    },
    result,
  );
  assert.deepEqual(wrong, [
    'entries misses bot',
    'entries lists extra, which it must not',
    'entries says reach: "outside" on screen, where it is "alive"',
    'entries lists extra, past the 3 it must hold exactly',
    'says complete: false where the right answer is complete',
  ]);
  const field = { missing: [{ field: 'deskId', id: 'handler' }] };
  assert.deepEqual(wrongIn({ lists: { missing: ['deskId'] } }, { first: field, lists: rowsByList([field], ['missing']), measured: { complete: false, calls: 1 } }), []);
});

test('an answer that says it is complete takes one call', () => {
  const answer = { entries: [{ id: 'a' }], complete: true };
  assert.deepEqual(wrongIn({}, { first: answer, lists: rowsByList([answer], ['entries']), measured: { complete: true, calls: 2 } }), ['answered complete, yet took 2 calls']);
});

test('follows the page an answer names, or the same question asked further, and nothing else', () => {
  assert.deepEqual(parseCall('who_calls({symbol: "a#b.ts:C.d", depth: 6})'), { tool: 'who_calls', args: { symbol: 'a#b.ts:C.d', depth: 6 } });
  assert.deepEqual(parseCall('search({query: "x", kinds: ["gaps"]})'), { tool: 'search', args: { query: 'x', kinds: ['gaps'] } });
  assert.equal(parseCall('not a call'), undefined);
  const args = { symbol: 'a#b.ts:C.d' };
  const deeper = { complete: false, next: ['cant_follow({service: "a"})', 'who_calls({symbol: "a#b.ts:C.d", depth: 6})'] };
  assert.deepEqual(followOn('who_calls', args, deeper), { args: { symbol: 'a#b.ts:C.d', depth: 6 }, paged: false });
  assert.deepEqual(followOn('list_entries', { maxNodes: 3 }, { complete: false, nextOffset: 3 }), { args: { maxNodes: 3, offset: 3 }, paged: true });
  // Another tool, another subject, or a complete answer: the question is answered.
  assert.equal(followOn('impact', args, { complete: false, next: ['get_flow({entry: "e"})'] }), undefined);
  assert.equal(followOn('who_calls', args, { complete: false, next: ['who_calls({symbol: "other", depth: 6})'] }), undefined);
  assert.equal(followOn('who_calls', args, { complete: true, next: ['who_calls({symbol: "a#b.ts:C.d", depth: 6})'] }), undefined);
});

test('every question names its fixture, tool, lists and a right answer, and ids are unique', () => {
  const budget = JSON.parse(readFileSync(new URL('./answer-budget.json', import.meta.url), 'utf8'));
  const ids = budget.questions.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const question of budget.questions) {
    assert.ok(question.fixture && question.tool && question.ask, question.id);
    assert.ok(Array.isArray(question.lists) && question.lists.length > 0, question.id);
    assert.ok(question.expect && Object.keys(question.expect).length > 0, `${question.id} has no right answer`);
    assert.equal(question.args.verbose, undefined, `${question.id} is asked as an agent asks, compact`);
    for (const name of question.expect.exact ?? []) assert.ok(question.expect.lists?.[name] || question.expect.rowsSay?.[name], `${question.id}: exact ${name} names no ids`);
  }
  for (const id of Object.keys(budget.recorded ?? {})) assert.ok(ids.includes(id), `${id} recorded for no question`);
});
