import { describe, expect, it } from 'vitest';
import { wasMissed, type UnresolvedLevel } from './graph.js';
import {
  findingsWithoutRisk,
  kindOfRow,
  reasonsWithoutKind,
  RISK_NAMES,
  RISKS,
  riskOf,
  ROW_KIND_NAMES,
  ROW_KINDS,
  rowClassOf,
  rowKindOf,
  rowRiskOf,
  type RowKind,
} from './row-kind.js';

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

describe('which risk a finding is (P100)', () => {
  it('gives every finding a risk, and nothing else one', () => {
    const findings = [...ROW_KINDS].filter(([, kind]) => kind === 'finding').map(([reason]) => reason);
    expect(findings.filter((reason) => riskOf(reason) === undefined)).toEqual([]);
    expect([...RISKS.keys()].filter((reason) => ROW_KINDS.get(reason) !== 'finding')).toEqual([]);
    expect(new Set(RISKS.values())).toEqual(new Set(RISK_NAMES));
  });

  it('reads a route with nothing in front of it as auth, and a query per item as performance', () => {
    expect(riskOf('route-unguarded')).toBe('auth');
    expect(riskOf('route-shadowed')).toBe('auth');
    expect(riskOf('query-in-loop')).toBe('performance');
    expect(riskOf('route-claimed-twice')).toBe('wiring');
  });

  it('has no risk for a gap, a note or a reason nobody classified', () => {
    expect(riskOf('target-route-not-found')).toBeUndefined();
    expect(riskOf('route-checked-in-body')).toBeUndefined();
    expect(riskOf('something-new')).toBeUndefined();
  });

  it('names the findings with no risk for the read gate, and only findings', () => {
    expect(findingsWithoutRisk()).toEqual([]);
    expect(findingsWithoutRisk(['route-unguarded', 'type-unresolved', 'something-new'])).toEqual([]);
  });
});

describe('a kind stored on the row (P208)', () => {
  const loop = { reason: 'query-in-loop' };
  const onPurpose = { reason: 'query-in-loop', meta: { severity: 'note' } };

  it('reads the kind a row was stored with, and decides one for a row that has none', () => {
    expect(rowKindOf({ reason: 'channel-dynamic', kind: 'note' })).toBe('note');
    expect(rowKindOf({ reason: 'channel-dynamic' })).toBe('gap');
    expect(rowKindOf({ ...onPurpose, kind: null })).toBe('note');
    // A column holding something no kind is, is not trusted.
    expect(rowKindOf({ reason: 'route-unguarded', kind: 'bogus' as RowKind })).toBe('finding');
  });

  it("reads a finding's stored risk, and none for a gap or a note whatever its reason", () => {
    expect(rowRiskOf({ ...loop, kind: 'finding', risk: 'performance' })).toBe('performance');
    expect(rowRiskOf({ ...loop, kind: 'note', risk: null })).toBeUndefined();
    expect(rowRiskOf(loop)).toBe('performance');
    expect(rowRiskOf(onPurpose)).toBeUndefined();
    expect(rowRiskOf({ reason: 'channel-dynamic' })).toBeUndefined();
  });

  it('classifies a row as kindOfRow and riskOf do, for every reason the registry knows', () => {
    for (const reason of ROW_KINDS.keys()) {
      const kind = kindOfRow({ reason });
      const risk = kind === 'finding' ? riskOf(reason) : undefined;
      expect(rowClassOf({ reason }), reason).toEqual(risk === undefined ? { kind } : { kind, risk });
      expect(rowKindOf({ reason, ...rowClassOf({ reason }) }), reason).toBe(kind);
      expect(rowRiskOf({ reason, ...rowClassOf({ reason }) }), reason).toBe(risk);
    }
    expect(rowClassOf(onPurpose)).toEqual({ kind: 'note' });
  });
});
