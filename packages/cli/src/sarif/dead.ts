/**
 * What nothing reaches, as SARIF findings (P115).
 *
 * Only what `dead` says is worth acting on: P91's actionable entries, and of
 * every kind only the `dead` and `likely-dead` verdicts of P95. A stream, an
 * infrastructure route, a route declared public and an `unknown` verdict are
 * not alerts: the graph's silence about them says nothing. Every result is a
 * note, as every row is a heuristic with the reason it fired; what could still
 * reach a route (a request read in part, one a segment off) is a related
 * location, so the reader sees what to check before deleting it.
 */
import type { DeadChannel, DeadEntry, DeadProvider } from '@flowatlas/linker';
import type { DeadField } from '../analysis/dead.js';
import { deadRule, type DeadKind } from './catalogue.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import { nodePlace, type NodeLookup } from './places.js';
import type { SarifFinding, SarifPlace, SarifStep } from './types.js';

/** The verdicts that are alerts. */
const ALERTS: ReadonlySet<string> = new Set(['dead', 'likely-dead']);

export interface DeadRows {
  entries?: readonly DeadEntry[];
  channels?: readonly DeadChannel[];
  providers?: readonly DeadProvider[];
  fields?: readonly DeadField[];
}

export interface DeadLookup extends NodeLookup {
  /** Where a type is declared: `<repo>#<file>`. */
  type?(id: string): { declaredIn: string } | undefined;
  /** The edges at a channel, to find the end it has. */
  edgesTo?(id: string, types?: readonly string[]): ReadonlyArray<{ from: string }>;
  edgesFrom?(id: string, types?: readonly string[]): ReadonlyArray<{ to: string }>;
}

const finding = (kind: DeadKind, id: string, message: string, at: SarifPlace | undefined, extra: Partial<SarifFinding> = {}): SarifFinding => ({
  rule: deadRule(kind),
  level: sarifLevelOf({ from: 'dead' }),
  message,
  at,
  key: { kind, value: KEYS.node(id) },
  ...extra,
});

/** A call one of the route's evidence names, placed in the service that makes it. */
const callStep = (lookup: NodeLookup | undefined, call: string, file: string | undefined, line: number | undefined, message: string): SarifStep => {
  const node = lookup?.node(call);
  const place: SarifPlace | undefined =
    file === undefined
      ? nodePlace(node)
      : { ...(node === undefined ? {} : { service: node.repo }), file, ...(line === undefined ? {} : { line }) };
  return { place, message };
};

const entryFinding = (row: DeadEntry, lookup?: NodeLookup): SarifFinding => {
  const related: SarifStep[] = [
    ...(row.evidence?.couldHit ?? []).map((miss) => callStep(lookup, miss.call, miss.file, miss.line, `could be reached by ${miss.path}`)),
    ...(row.evidence?.oneOff ?? []).map((off) => callStep(lookup, off.call, off.file, off.line, `${off.asks} is one segment off (${off.differs})`)),
  ];
  return finding(
    'dead-entry',
    row.id,
    `${row.service} ${row.key} is ${row.verdict}: ${row.reason}`,
    { service: row.service, file: row.file ?? '', ...(row.line === undefined ? {} : { line: row.line }) },
    {
      fallbackService: row.service,
      ...(related.length === 0 ? {} : { related }),
      properties: { verdict: row.verdict, entryKind: row.kind, confidence: row.confidence },
    },
  );
};

/**
 * A channel with one end, at the end it has: the publish, or the handler.
 * Placed at the line of the configuration naming the service of that end when
 * the graph keeps no file for it.
 */
const channelFinding = (row: DeadChannel, lookup?: DeadLookup): SarifFinding => {
  const ends = [
    ...(lookup?.edgesTo?.(row.id, ['emits']) ?? []).map((edge) => ({ id: edge.from, said: 'publishes it' })),
    ...(lookup?.edgesFrom?.(row.id, ['consumes']) ?? []).map((edge) => ({ id: edge.to, said: 'consumes it' })),
  ].map((end) => ({ place: nodePlace(lookup?.node(end.id)), message: `${lookup?.node(end.id)?.label ?? end.id} ${end.said}` }));
  const [first, ...rest] = ends.filter((end) => end.place !== undefined && end.place.file !== '');
  const service = first?.place?.service ?? row.producers[0] ?? row.consumers[0];
  return finding('dead-channel', row.id, `${row.id} is ${row.verdict}: ${row.reason}`, first?.place, {
    ...(service === undefined ? {} : { fallbackService: service }),
    ...(rest.length === 0 ? {} : { related: rest }),
    properties: { verdict: row.verdict, ...(row.evidence.missing === undefined ? {} : { missing: row.evidence.missing }) },
  });
};

const providerFinding = (row: DeadProvider): SarifFinding =>
  finding(
    'dead-provider',
    row.id,
    `${row.service} ${row.id.slice(row.id.lastIndexOf(':') + 1)} is ${row.verdict}: ${row.reason}`,
    { service: row.service, file: row.file ?? '', ...(row.line === undefined ? {} : { line: row.line }) },
    { fallbackService: row.service, properties: { verdict: row.verdict } },
  );

/** Where a type is declared, from its `<repo>#<file>`; no line, since the registry keeps none. */
const typePlace = (lookup: DeadLookup | undefined, typeId: string): SarifPlace | undefined => {
  const declared = lookup?.type?.(typeId)?.declaredIn;
  const hash = declared?.indexOf('#') ?? -1;
  return declared === undefined || hash < 0 ? undefined : { service: declared.slice(0, hash), file: declared.slice(hash + 1) };
};

const fieldFinding = (row: DeadField, lookup?: DeadLookup): SarifFinding => ({
  rule: deadRule('dead-field'),
  level: sarifLevelOf({ from: 'dead' }),
  message: `${row.typeId} field ${row.field} is removed by the receiving side before it is read (sent on ${row.sentOn.join(', ')})`,
  at: typePlace(lookup, row.typeId),
  key: { kind: 'dead-field', value: `${row.typeId}|${row.field}|${row.direction}` },
  properties: { direction: row.direction },
});

/** The rows that are alerts, as findings. */
export const deadFindings = (rows: DeadRows, lookup?: DeadLookup): SarifFinding[] => [
  ...(rows.entries ?? []).filter((row) => row.class === 'actionable' && ALERTS.has(row.verdict)).map((row) => entryFinding(row, lookup)),
  ...(rows.channels ?? []).filter((row) => ALERTS.has(row.verdict)).map((row) => channelFinding(row, lookup)),
  ...(rows.providers ?? []).filter((row) => ALERTS.has(row.verdict)).map(providerFinding),
  ...(rows.fields ?? []).filter((row) => row.dropped).map((row) => fieldFinding(row, lookup)),
];
