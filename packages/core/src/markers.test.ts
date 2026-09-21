import { describe, expect, it } from 'vitest';
import { namesGivenTo, takesNames } from './markers.js';

const given = (...args: unknown[]) => namesGivenTo({ name: 'Emits', args });

/**
 * What an annotation was given, read once for everyone who reads annotations.
 *
 * Three readers used to ask three narrower questions of these same values, and
 * between them a second argument was dropped, a list was ignored, and neither
 * said a word (R38).
 */
describe('the names an annotation gives', () => {
  it('reads one name', () => {
    expect(given('a')).toEqual({ names: ['a'], refused: [] });
  });

  it('reads every argument, not only the first', () => {
    expect(given('a', 'b').names).toEqual(['a', 'b']);
  });

  it('reads a list as the names in it', () => {
    expect(given(['a', 'b']).names).toEqual(['a', 'b']);
  });

  it('reads the two written together, in the order written', () => {
    expect(given('a', ['b', 'c'], 'd').names).toEqual(['a', 'b', 'c', 'd']);
  });

  it('says a name once, however many times it was given', () => {
    // A catalogue and a literal can name the same channel, and two edges to one
    // channel from one method is one edge said twice.
    expect(given('a', ['a', 'b'], 'b').names).toEqual(['a', 'b']);
  });

  it('refuses what the resolver could not read, and says what was written', () => {
    expect(given({ unresolved: "this.channelFor('x')" })).toEqual({
      names: [],
      refused: [{ text: "this.channelFor('x')", why: 'unreadable' }],
    });
  });

  it('refuses what resolved to something that is not a name', () => {
    // The case that used to vanish without a word: resolved, so nothing called
    // it unreadable, and not a string, so nothing called it a name either.
    expect(given(42).refused).toEqual([{ text: '42', why: 'not-a-name' }]);
    expect(given({ channel: 'a' }).refused[0]?.why).toBe('not-a-name');
    expect(given(['a', 7]).refused[0]?.why).toBe('not-a-name');
  });

  it('keeps the names it could read beside the arguments it refused', () => {
    // Refusing one argument must not throw away the others: a reader who wrote
    // three and mistyped one has still said two true things.
    const found = given('a', { unresolved: 'x()' }, 'b');
    expect(found.names).toEqual(['a', 'b']);
    expect(found.refused).toHaveLength(1);
  });

  it('answers with nothing for an empty list, and refuses nothing', () => {
    // `@Emits(...EMPTY)` has named nothing, which is a fact about the
    // catalogue rather than about the argument. Whoever asked decides what to
    // say about a marker left naming nothing.
    expect(given([])).toEqual({ names: [], refused: [] });
    expect(given()).toEqual({ names: [], refused: [] });
  });

  it('skips the arguments the marker does not spend on names', () => {
    // `@CallsService('orders', 'POST /a', 'POST /b')` spends its first on the
    // service, and every one after it is a route. Which those are is the
    // marker's own business, not the caller's, so nobody counts them off.
    const marker = { name: 'CallsService', args: ['orders', 'POST /a', ['POST /b']] };
    expect(namesGivenTo(marker).names).toEqual(['POST /a', 'POST /b']);
    expect(namesGivenTo({ ...marker, name: 'Emits' }).names).toEqual([
      'orders',
      'POST /a',
      'POST /b',
    ]);
  });

  it('knows which markers take names at all', () => {
    // The list a new annotation has to join, in one place: missing from it, a
    // marker reads as taking no names and says nothing about it (R38).
    for (const name of ['Emits', 'Consumes', 'CallsService']) {
      expect(takesNames(name), name).toBe(true);
    }
    for (const name of ['FlowEntry', 'ContractIgnore', 'Whatever']) {
      expect(takesNames(name), name).toBe(false);
    }
  });
});
