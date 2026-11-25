import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asksFurther, ceilingOf, followOn, listsOf, overBudget, parseCall, rowsByList, tokensOf, wrongIn } from './answer-budget-rules.mjs';

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
  // A list said once beside several answers, for all of them (P376).
  const shared = { answers: [{ callers: [{ id: 'c1' }] }, { callers: [{ id: 'c2' }] }], waysIn: [{ id: 'w' }] };
  assert.deepEqual(rowsByList([shared], ['callers', 'waysIn']).get('waysIn').map((row) => row.id), ['w']);
  assert.deepEqual(rowsByList([shared], ['callers', 'waysIn']).get('callers').map((row) => row.id), ['c1', 'c2']);
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
  // A field a row must say may be a list, compared whole.
  const ways = { waysIn: [{ id: 'route', reaches: ['a', 'b'] }] };
  assert.deepEqual(wrongIn({ rowsSay: { waysIn: { route: { reaches: ['a', 'b'] } } } }, { first: ways, lists: rowsByList([ways], ['waysIn']), measured: { complete: null, calls: 1 } }), []);
  assert.deepEqual(wrongIn({ rowsSay: { waysIn: { route: { reaches: ['a'] } } } }, { first: ways, lists: rowsByList([ways], ['waysIn']), measured: { complete: null, calls: 1 } }), [
    'waysIn says reaches: ["a","b"] on route, where it is ["a"]',
  ]);
  const field = { missing: [{ field: 'deskId', id: 'handler' }] };
  assert.deepEqual(wrongIn({ lists: { missing: ['deskId'] } }, { first: field, lists: rowsByList([field], ['missing']), measured: { complete: false, calls: 1 } }), []);
});

test('matches a row of throughChannels by its consumer, and holds it to one row per consumer (P378)', () => {
  const expect = { exact: ['throughChannels'], rowsSay: { throughChannels: { 'consumer:bot': { channels: ['a', 'b'], ways: 2 } } } };
  const once = { first: { complete: true }, lists: new Map([['throughChannels', [{ consumer: 'consumer:bot', channels: ['a', 'b'], ways: 2 }]]]), measured: { complete: true, calls: 1 } };
  assert.deepEqual(wrongIn(expect, once), []);
  const twice = {
    ...once,
    lists: new Map([['throughChannels', [{ consumer: 'consumer:bot', channels: ['a', 'b'], ways: 2 }, { consumer: 'consumer:other', channels: ['b'], ways: 2 }]]]),
  };
  assert.deepEqual(wrongIn(expect, twice), ['throughChannels lists consumer:other, past the 1 it must hold exactly']);
  const repeated = {
    ...once,
    lists: new Map([['throughChannels', [{ consumer: 'consumer:bot', channels: ['a'], ways: 2 }, { consumer: 'consumer:bot', channels: ['b'], ways: 1 }]]]),
  };
  assert.deepEqual(wrongIn(expect, repeated), ['throughChannels says channels: ["a"] on consumer:bot, where it is ["a","b"]', 'throughChannels lists consumer:bot more than once']);
});

test('an answer that says it is complete takes one call', () => {
  const answer = { entries: [{ id: 'a' }], complete: true };
  assert.deepEqual(wrongIn({}, { first: answer, lists: rowsByList([answer], ['entries']), measured: { complete: true, calls: 2 } }), ['answered complete, yet took 2 calls']);
});

test('a filtered or fuzzy answer that says it is complete is wrong (P381)', () => {
  const answer = { entries: [{ id: 'a' }], complete: true };
  assert.deepEqual(wrongIn({ complete: false }, { first: answer, lists: rowsByList([answer], ['entries']), measured: { complete: true, calls: 1 } }), [
    'says complete: true where the right answer is not complete',
  ]);
  const honest = { entries: [{ id: 'a' }], complete: false, left: ['filter: 1 way in in other services left out (callersIn: x)'] };
  assert.deepEqual(wrongIn({ complete: false }, { first: honest, lists: rowsByList([honest], ['entries']), measured: { complete: false, calls: 1 } }), []);
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

test('fails a complete answer whose next asks the same call further (P376)', () => {
  const args = { symbol: 'a#b.ts:C.d' };
  assert.equal(
    asksFurther('who_calls', args, { complete: true, next: ['who_calls({symbol: "a#b.ts:C.d", depth: 6})'] }),
    'answered complete, yet next asks it further: who_calls({"symbol":"a#b.ts:C.d","depth":6})',
  );
  assert.equal(asksFurther('who_calls', args, { complete: true, next: ['get_flow({entry: "e"})'] }), undefined);
  // An answer that is not complete may name the call that walks on.
  assert.equal(asksFurther('who_calls', args, { complete: false, next: ['who_calls({symbol: "a#b.ts:C.d", depth: 6})'] }), undefined);
});

test('every question names its fixture, tool, lists and a right answer, and ids are unique', () => {
  const budget = JSON.parse(readFileSync(new URL('./answer-budget.json', import.meta.url), 'utf8'));
  const ids = budget.questions.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const question of budget.questions) {
    // Asked as a prompt (P386): the card the prompt hook makes, its calls and ids its right answer.
    if (question.prompt !== undefined) {
      assert.ok(question.fixture && question.ask && question.tool === undefined, question.id);
      assert.ok(question.expect?.silent === true || (Array.isArray(question.expect?.cards) && question.expect.cards.length > 0), `${question.id} has no right answer`);
      continue;
    }
    assert.ok(question.fixture && question.tool && question.ask, question.id);
    assert.ok(Array.isArray(question.lists) && question.lists.length > 0, question.id);
    assert.ok(question.expect && Object.keys(question.expect).length > 0, `${question.id} has no right answer`);
    assert.equal(question.args.verbose, undefined, `${question.id} is asked as an agent asks, compact`);
    for (const name of question.expect.exact ?? []) assert.ok(question.expect.lists?.[name] || question.expect.rowsSay?.[name], `${question.id}: exact ${name} names no ids`);
  }
  for (const id of Object.keys(budget.recorded ?? {})) assert.ok(ids.includes(id), `${id} recorded for no question`);
});

test('holds a plain-text answer to what its text must and must not say (P382)', () => {
  const result = { first: { text: '29  cancel() { … }' }, lists: new Map(), measured: { complete: null, calls: 1 } };
  assert.deepEqual(wrongIn({ says: ['cancel() { … }'], saysNot: ['\\n'] }, result), []);
  assert.deepEqual(wrongIn({ says: ['ready()'] }, result), ['the text does not say "ready()"']);
  assert.deepEqual(wrongIn({ saysNot: ['cancel'] }, result), ['the text says "cancel", which it must not']);
});

test('fails an answer that settles its question without saying so, or says so beside a further call (P403)', () => {
  const measured = { complete: true, calls: 1 };
  const plain = { entries: [{ id: 'route' }], complete: true };
  assert.deepEqual(wrongIn({ settled: true }, { first: plain, lists: rowsByList([plain], ['entries']), measured }), ['does not say settled where the answer settles the question']);
  const both = { settled: '1 way in breaks, all listed', entries: [{ id: 'route' }], complete: true, next: ['get_flow({entry: "route"})'] };
  assert.deepEqual(wrongIn({ settled: true }, { first: both, lists: rowsByList([both], ['entries']), measured }), ['says settled, yet names a further call in next']);
  const settled = { settled: '1 way in breaks, all listed', entries: [{ id: 'route' }], complete: true };
  assert.deepEqual(wrongIn({ settled: true }, { first: settled, lists: rowsByList([settled], ['entries']), measured }), []);
});
