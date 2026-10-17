import { describe, expect, it } from 'vitest';
import { wasMissed, type UnresolvedLevel } from './graph.js';
import { kindOfRow, reasonsWithoutKind, ROW_KIND_NAMES, ROW_KINDS, type RowKind } from './row-kind.js';

describe('what a row is about', () => {
  // A fixed list, so a reason moved from one kind to another is a change
  // somebody makes on purpose here, not a side effect of editing the registry.
  const EXPECTED: ReadonlyArray<[string, RowKind]> = [
    ['call-dynamic-receiver', 'gap'],
    ['type-unresolved', 'gap'],
    ['unknown-base-url-env', 'gap'],
    ['environment-not-set', 'gap'],
    ['handler-not-a-method', 'gap'],
    ['target-route-not-found', 'gap'],
    ['base-url-from-files', 'note'],
    ['base-url-from-name', 'note'],
    ['environment-from-files', 'note'],
    ['package-from-repo', 'note'],
    ['shape-file-unmatched', 'note'],
    ['route-checked-in-body', 'note'],
    ['route-mount-assumed-empty', 'note'],
    ['document-age', 'note'],
    ['query-in-loop', 'finding'],
    ['route-unguarded', 'finding'],
    ['route-shadowed', 'finding'],
  ];

  it.each(EXPECTED)('%s is a %s', (reason, kind) => {
    expect(kindOfRow({ reason })).toBe(kind);
    expect(ROW_KINDS.get(reason)).toBe(kind);
  });

  it('takes a reason nobody classified for a gap, so it is counted rather than hidden', () => {
    expect(kindOfRow({ reason: 'something-new' })).toBe('gap');
    expect(ROW_KINDS.has('something-new')).toBe(false);
  });

  // P89's contract: a loop that is per item on purpose is a note, and a loop
  // worth fixing stays a finding. Both sit at `info`.
  it('reads a query-in-loop row by the severity it recorded', () => {
    expect(kindOfRow({ reason: 'query-in-loop', meta: { severity: 'note' } })).toBe('note');
    expect(kindOfRow({ reason: 'query-in-loop', meta: { severity: 'likely' } })).toBe('finding');
    expect(kindOfRow({ reason: 'query-in-loop', meta: null })).toBe('finding');
    // A severity on any other reason says nothing about its kind.
    expect(kindOfRow({ reason: 'type-unresolved', meta: { severity: 'note' } })).toBe('gap');
  });

  it('names every kind it gives', () => {
    expect(new Set(ROW_KINDS.values())).toEqual(new Set(ROW_KIND_NAMES));
  });
});

describe('whether a row was missed', () => {
  const levels: readonly (UnresolvedLevel | undefined)[] = [undefined, 'action', 'info', 'nothing'];

  it('is never true of a note or a finding, at any level', () => {
    for (const level of levels) {
      expect(wasMissed({ reason: 'base-url-from-files', ...(level === undefined ? {} : { level }) })).toBe(false);
      expect(wasMissed({ reason: 'query-in-loop', ...(level === undefined ? {} : { level }) })).toBe(false);
      expect(wasMissed({ reason: 'route-unguarded', ...(level === undefined ? {} : { level }) })).toBe(false);
    }
  });

  it('is true of a gap at every level but nothing', () => {
    expect(wasMissed({ reason: 'type-unresolved' })).toBe(true);
    expect(wasMissed({ reason: 'type-unresolved', level: 'action' })).toBe(true);
    expect(wasMissed({ reason: 'type-unresolved', level: 'info' })).toBe(true);
    expect(wasMissed({ reason: 'handler-not-a-method', level: 'nothing' })).toBe(false);
  });
});

describe('the read gate over kinds', () => {
  it('names the reasons with no kind of their own, in the order given', () => {
    expect(reasonsWithoutKind(['type-unresolved', 'something-new', 'query-in-loop', 'another-one'])).toEqual([
      'something-new',
      'another-one',
    ]);
  });

  it('says nothing about a list of classified reasons', () => {
    expect(reasonsWithoutKind(ROW_KINDS.keys())).toEqual([]);
  });
});
