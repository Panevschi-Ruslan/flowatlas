import { describe, expect, it } from 'vitest';
import { contractFindings } from './contracts.js';
import { doctorFindings } from './doctor.js';
import { FINGERPRINT_VERSION, GITHUB_FINGERPRINT } from './fingerprints.js';
import { ruleFindings } from './rules.js';
import { contractError, emptyDoctor, LOOKUP, PATHS, violation } from './test-inputs.js';
import type { SarifFinding } from './types.js';
import { toSarif } from './write.js';

const fingerprints = (findings: readonly SarifFinding[]): Array<Record<string, string>> =>
  toSarif({ command: 'doctor', version: '0.0.0', findings, paths: PATHS }).runs[0]?.results.map((result) => result.partialFingerprints) ?? [];

const doctorWith = (line: number, symbol = 'this.http.post(url)') => {
  const report = emptyDoctor();
  report.unresolved.byReason = [
    {
      reason: 'dynamic-http-url',
      level: 'action',
      kind: 'gap',
      count: 1,
      sites: 1,
      known: true,
      excluded: false,
      hint: 'Annotate the call.',
      rows: [{ service: 'shop', file: 'src/cart.client.ts', line, symbol, level: 'action', sites: 1, message: 'built at run time', hint: 'Annotate the call.' }],
    },
  ];
  return doctorFindings(report);
};

describe('fingerprints (P115, D2)', () => {
  it('carry the flowatlas key under its own version and the one code scanning matches on', () => {
    const [print] = fingerprints(doctorWith(14));
    expect(Object.keys(print ?? {}).sort()).toEqual([FINGERPRINT_VERSION, GITHUB_FINGERPRINT].sort());
    expect(print?.[GITHUB_FINGERPRINT]).toBe(`${print?.[FINGERPRINT_VERSION]?.slice(0, 16)}:1`);
  });

  it('stay the same when a row moves down a line, and change when it is about something else', () => {
    expect(fingerprints(doctorWith(15))).toEqual(fingerprints(doctorWith(14)));
    expect(fingerprints(doctorWith(14, 'this.http.put(url)'))).not.toEqual(fingerprints(doctorWith(14)));
  });

  it('stay the same when a contract finding\'s sender moves, and change with the field', () => {
    const moved = { node: (id: string) => {
      const node = LOOKUP.node(id);
      return node === undefined ? undefined : { ...node, line: (node.line ?? 0) + 7 };
    } };
    const here = fingerprints(contractFindings({ findings: [contractError()] }, { lookup: LOOKUP }));
    expect(fingerprints(contractFindings({ findings: [contractError()] }, { lookup: moved }))).toEqual(here);
    expect(fingerprints(contractFindings({ findings: [contractError({ field: 'qty' })] }, { lookup: LOOKUP }))).not.toEqual(here);
  });

  it('stay the same when a rule violation\'s crossing moves, and change with what it reaches', () => {
    const here = fingerprints(ruleFindings({ violations: [violation()] }));
    expect(fingerprints(ruleFindings({ violations: [violation({ at: { service: 'shop', file: 'src/cart.client.ts', line: 40 } })] }))).toEqual(here);
    expect(fingerprints(ruleFindings({ violations: [violation({ key: 'rule|shop-stays-out|x|y' })] }))).not.toEqual(here);
  });

  it('never let two kinds of finding share one', () => {
    const contract = fingerprints(contractFindings({ findings: [contractError()] }))[0];
    const rule = fingerprints(ruleFindings({ violations: [violation()] }))[0];
    expect(contract?.[FINGERPRINT_VERSION]).not.toBe(rule?.[FINGERPRINT_VERSION]);
  });
});
