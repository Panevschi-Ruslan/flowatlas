import { describe, expect, it } from 'vitest';
import { cycleFindings } from './cycles.js';
import { contractFindings } from './contracts.js';
import { deadFindings } from './dead.js';
import { diffFindings } from './diff.js';
import { doctorFindings } from './doctor.js';
import { sarifLevelOf } from './levels.js';
import { ruleFindings } from './rules.js';
import { sarifProblems } from './schema-check.js';
import { contractError, cycle, emptyDoctor, LOOKUP, PATHS, unchecked, violation } from './test-inputs.js';
import type { SarifFinding, SarifInput, SarifLog } from './types.js';
import { SOURCE_ROOT, toSarif } from './write.js';

const logOf = (findings: readonly SarifFinding[], extra: Partial<SarifInput> = {}): SarifLog =>
  toSarif({ command: 'contracts', version: '1.2.3', findings, paths: PATHS, ...extra });

const runOf = (log: SarifLog) => log.runs[0] as SarifLog['runs'][number];

/** The primary place of each result, as `uri:line`. */
const places = (log: SarifLog): string[] =>
  runOf(log).results.map((result) => {
    const at = result.locations[0]?.physicalLocation;
    return `${at?.artifactLocation.uri ?? '-'}:${at?.region?.startLine ?? ''}`;
  });

describe('the level map (P115)', () => {
  it('is one table every source is asked through', () => {
    expect(sarifLevelOf({ from: 'contract', severity: 'error' })).toBe('error');
    expect(sarifLevelOf({ from: 'contract', severity: 'warning' })).toBe('warning');
    expect(sarifLevelOf({ from: 'contract', severity: 'info' })).toBe('note');
    expect(sarifLevelOf({ from: 'unresolved', level: 'action', kind: 'gap' })).toBe('warning');
    expect(sarifLevelOf({ from: 'unresolved', level: 'action', kind: 'finding' })).toBe('warning');
    expect(sarifLevelOf({ from: 'unresolved', level: 'info', kind: 'gap' })).toBe('note');
    expect(sarifLevelOf({ from: 'unresolved', level: 'nothing', kind: 'gap' })).toBeUndefined();
    expect(sarifLevelOf({ from: 'unresolved', level: 'action', kind: 'note' })).toBeUndefined();
    expect(sarifLevelOf({ from: 'desync' })).toBe('error');
    expect(sarifLevelOf({ from: 'marker', severity: 'warning' })).toBe('warning');
    expect(sarifLevelOf({ from: 'dead' })).toBe('note');
    expect(sarifLevelOf({ from: 'cycle' })).toBe('warning');
    expect(sarifLevelOf({ from: 'rule', severity: 'info' })).toBe('note');
  });
});

describe('toSarif (P115)', () => {
  it('writes one run under its own category, with the tool and the rules its results use', () => {
    const log = logOf(contractFindings({ findings: [contractError()] }, { lookup: LOOKUP }));
    const run = runOf(log);
    expect(log.version).toBe('2.1.0');
    expect(run.automationDetails.id).toBe('flowatlas/contracts/');
    expect(run.tool.driver).toMatchObject({ name: 'flowatlas', semanticVersion: '1.2.3' });
    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual(['missing_required']);
    expect(run.tool.driver.rules[0]?.defaultConfiguration.level).toBe('error');
    expect(run.results[0]?.ruleIndex).toBe(0);
    expect(sarifProblems(log)).toEqual([]);
  });

  it('puts a contract error at the sender\'s line, with the receiver as a related location linked in the message', () => {
    const run = runOf(logOf(contractFindings({ findings: [contractError()] }, { lookup: LOOKUP })));
    const [result] = run.results;
    expect(run.results).toHaveLength(1);
    expect(result?.level).toBe('error');
    expect(result?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'shop/src/cart.client.ts', uriBaseId: SOURCE_ROOT },
      region: { startLine: 12 },
    });
    expect(result?.relatedLocations?.[0]).toMatchObject({
      id: 1,
      physicalLocation: { artifactLocation: { uri: 'services/catalog/src/items.controller.ts' }, region: { startLine: 30 } },
    });
    expect(result?.message.text).toContain('[receiver catalog](1)');
  });

  it('places a party found only by its id at its file, never at a guessed line', () => {
    const run = runOf(logOf(contractFindings({ findings: [contractError()] })));
    expect(run.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'shop/src/cart.client.ts', uriBaseId: SOURCE_ROOT },
    });
  });

  it('writes an excused contract finding suppressed, in the code or in the configuration', () => {
    const findings = contractFindings(
      {
        findings: [],
        ignored: [
          contractError({ ignored: true, ignoredBy: 'shop#src/cart.client.ts:CartClient.add' }),
          contractError({ field: 'qty', ignored: true, ignoredBy: 'config:contracts.ignoreEdges' }),
        ],
      },
      { lookup: LOOKUP },
    );
    const kinds = runOf(logOf(findings)).results.map((result) => result.suppressions?.[0]?.kind);
    expect(kinds.sort()).toEqual(['external', 'inSource']);
  });

  it('writes a rule violation at its crossing hop, the target related, the path a code flow in order', () => {
    const log = logOf(ruleFindings({ violations: [violation()] }, { lookup: LOOKUP }), { command: 'rules' });
    const [result] = runOf(log).results;
    expect(result?.ruleId).toBe('rule/shop-stays-out');
    expect(places(log)).toEqual(['shop/src/cart.client.ts:14']);
    expect(result?.relatedLocations?.[0]?.message?.text).toBe('target POST /items');
    const steps = result?.codeFlows?.[0]?.threadFlows[0]?.locations ?? [];
    expect(steps.map((step) => step.location.message?.text)).toEqual(['shop CartClient.add', 'calls POST /items', 'http_calls POST /items']);
    expect(steps.map((step) => step.executionOrder)).toEqual([1, 2, 3]);
    expect(result?.message.text).toContain('the shop asks the gateway');
    expect(sarifProblems(log)).toEqual([]);
  });

  it('places a rule that could not be checked at the configuration line naming it (I3)', () => {
    const log = logOf(ruleFindings({ violations: [], unchecked: [unchecked] }), { command: 'rules' });
    expect(places(log)).toEqual(['flowatlas.config.json:21']);
    expect(runOf(log).results[0]?.level).toBe('warning');
  });

  it('writes a violation accepted.json excused as unchanged and suppressed with its note', () => {
    const [result] = runOf(logOf(ruleFindings({ violations: [], excused: [violation({ excusedBy: 'agreed with the team' })] }))).results;
    expect(result?.baselineState).toBe('unchanged');
    expect(result?.suppressions).toEqual([{ kind: 'external', justification: 'agreed with the team' }]);
  });

  it('writes a cycle with every hop a step of its code flow, in order', () => {
    const log = logOf(cycleFindings([cycle], LOOKUP), { command: 'cycles' });
    const [result] = runOf(log).results;
    expect(result?.level).toBe('warning');
    const steps = result?.codeFlows?.[0]?.threadFlows[0]?.locations ?? [];
    expect(steps.map((step) => step.location.physicalLocation?.region?.startLine)).toEqual([12, 14, 30, 12]);
    expect(steps.at(-1)?.location.message?.text).toBe('http_calls shop:CartClient.add');
    expect(sarifProblems(log)).toEqual([]);
  });

  it('writes only the dead rows worth acting on, as notes', () => {
    const entry = { id: 'entry:catalog:http:POST:/items', service: 'catalog', kind: 'http', key: 'POST:/items', file: 'src/items.controller.ts', line: 29, reason: 'no http_calls/hits from any repo', why: '', confidence: 'dead' } as const;
    const findings = deadFindings({
      entries: [
        { ...entry, class: 'actionable', verdict: 'dead' },
        { ...entry, id: 'entry:catalog:http:GET:/health', key: 'GET:/health', class: 'infrastructure', verdict: 'dead' },
        { ...entry, id: 'entry:catalog:http:GET:/items', key: 'GET:/items', class: 'actionable', verdict: 'unknown' },
      ],
    });
    const run = runOf(logOf(findings, { command: 'dead' }));
    expect(run.results.map((result) => [result.ruleId, result.level])).toEqual([['dead-entry', 'note']]);
  });

  it('marks a diff\'s new findings new on the head side and its fixed ones absent on the base side', () => {
    const findings = diffFindings(
      {
        contracts: { new: [contractError()], fixed: [contractError({ field: 'qty' })], preexisting: [], ignored: [] },
        rules: { new: [violation()], fixed: [], existing: [], excused: [] },
      },
      { head: LOOKUP },
    );
    const states = runOf(logOf(findings, { command: 'diff' })).results.map((result) => `${result.ruleId}:${result.baselineState}`);
    expect(states.sort()).toEqual(['missing_required:absent', 'missing_required:new', 'rule/shop-stays-out:new']);
  });

  it('writes doctor rows by level and kind, held against the baseline, and accepted rows suppressed', () => {
    const report = emptyDoctor();
    const row = { service: 'shop', file: 'src/cart.client.ts', line: 14, symbol: 'this.http.post(url)', level: 'action' as const, sites: 1, message: 'the address is built at run time', hint: 'Annotate the call.' };
    report.unresolved.byReason = [
      { reason: 'dynamic-http-url', level: 'action', kind: 'gap', count: 2, sites: 2, known: true, excluded: false, hint: 'Annotate the call.', rows: [row, { ...row, line: 20, symbol: 'this.http.get(url)' }] },
      { reason: 'route-api-guessed', level: 'action', kind: 'note', count: 1, sites: 1, known: true, excluded: false, hint: 'h', rows: [{ ...row, line: 30 }] },
      { reason: 'template-binding', level: 'nothing', kind: 'gap', count: 1, sites: 1, known: true, excluded: false, hint: 'h', rows: [{ ...row, line: 40, level: 'nothing' }] },
    ];
    report.baseline = { ...report.baseline, status: 'ok', newKeys: ['shop|src/cart.client.ts|this.http.get(url)|dynamic-http-url'] };
    report.unresolved.withoutWaysIn = [{ service: 'catalog', looksLike: 'it is configured as nestjs' }];
    const accepted = [
      {
        row: { reason: 'route-unguarded', service: 'catalog', file: 'src/items.controller.ts', line: 29, level: 'action' as const, symbol: 'POST /items', message: 'POST /items has no guard' },
        entry: { reason: 'route-unguarded', service: 'catalog', note: 'public on purpose', acceptedAt: '2026-01-01T00:00:00.000Z' },
      },
    ];
    const log = toSarif({ command: 'doctor', version: '1.2.3', findings: doctorFindings(report, { accepted }), paths: PATHS });
    const results = runOf(log).results;
    const said = results.map((result) => `${result.ruleId}@${result.locations[0]?.physicalLocation?.region?.startLine}:${result.baselineState ?? '-'}:${result.suppressions?.[0]?.justification ?? '-'}`);
    expect(said).toEqual([
      'no-way-in@9:-:-',
      'route-unguarded@29:unchanged:public on purpose',
      'dynamic-http-url@14:unchanged:-',
      'dynamic-http-url@20:new:-',
    ]);
    expect(sarifProblems(log)).toEqual([]);
  });

  it('cuts at the bound, loudest first, and says how many were left out and where the whole report is', () => {
    const findings = [
      ...contractFindings({ findings: [contractError({ severity: 'info', field: 'a' }), contractError({ severity: 'warning', field: 'b' })] }),
      ...contractFindings({ findings: [contractError({ field: 'c' })] }),
    ];
    const run = runOf(logOf(findings, { maxResults: 2, cutBefore: 3, completeFile: '/work/project/.flowatlas/contracts.json' }));
    expect(run.results.map((result) => result.level)).toEqual(['error', 'warning']);
    const [note] = run.invocations[0]?.toolExecutionNotifications ?? [];
    expect(note?.message.text).toBe('4 results left out by the bound on this output (--max-nodes or --max); the complete report is in /work/project/.flowatlas/contracts.json');
  });

  it('leaves out what is quieter than --sarif-level', () => {
    const findings = contractFindings({ findings: [contractError({ severity: 'info', field: 'a' }), contractError()] });
    expect(runOf(logOf(findings, { minLevel: 'warning' })).results.map((result) => result.level)).toEqual(['error']);
  });

  it('writes paths relative to --sarif-root, and leaves a result in another checkout out, counted', () => {
    const findings = contractFindings({ findings: [contractError(), contractError({ field: 'qty', sender: { service: 'catalog', typeId: null, symbol: 'catalog#src/items.controller.ts:ItemsController.add' } })] }, { lookup: LOOKUP });
    const log = logOf(findings, { paths: { ...PATHS, sarifRoot: '/work/project/shop' } });
    expect(places(log)).toEqual(['src/cart.client.ts:12']);
    const related = runOf(log).results[0]?.relatedLocations?.[0];
    expect(related?.physicalLocation).toBeUndefined();
    expect(related?.message?.text).toContain('another checkout');
    expect(runOf(log).invocations[0]?.toolExecutionNotifications?.[0]?.message.text).toContain('1 result in files outside --sarif-root');
    expect(runOf(log).originalUriBaseIds).not.toHaveProperty('catalog');
  });

  it('numbers results that share a fingerprint, and is the same bytes on every run', () => {
    const twice = [...contractFindings({ findings: [contractError()] }), ...contractFindings({ findings: [contractError()] })];
    const log = logOf(twice);
    expect(runOf(log).results.map((result) => result.partialFingerprints['primaryLocationLineHash']?.split(':')[1])).toEqual(['1', '2']);
    expect(JSON.stringify(logOf(twice))).toBe(JSON.stringify(log));
  });
});
