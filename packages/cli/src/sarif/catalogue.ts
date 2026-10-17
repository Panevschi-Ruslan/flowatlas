/**
 * The rules a SARIF log reports under (P115): every `ruleId` a stable code
 * already in use, described from the catalogue that already describes it.
 *
 * A doctor reason is described by its label and its hint (`hints.ts`), a
 * marker code, a contract finding kind and a dead kind by the few words
 * below, a P114 rule by its name, shape and note. A reason the catalogue has
 * never heard of is still a rule, with the generic sentence that says where
 * to register it, so nothing is dropped for want of a description.
 */
import type { FindingKind } from '@flowatlas/contracts';
import { kindOfRow } from '@flowatlas/core';
import type { MarkerCode } from '../doctor/markers.js';
import { FINDING_LABELS, genericHint, kindHint } from '../doctor/hints.js';
import type { SarifLevel, SarifRuleInfo } from './types.js';

/** A reason in words, where no label says it better: `target-route-not-found` → `target route not found`. */
const words = (code: string): string => code.replace(/[-_]+/g, ' ').trim();

/** What a doctor reason is, by its label (P81) or its own words. */
export const reasonShort = (reason: string): string => {
  const label = Object.hasOwn(FINDING_LABELS, reason) ? FINDING_LABELS[reason] : undefined;
  return label === undefined ? words(reason) : label[0];
};

/** How a doctor reason's rows are accepted, said once per rule. */
const acceptLine = (reason: string): string =>
  `See every place with \`flowatlas doctor\`; accept one with \`flowatlas accept ${reason} --service <name> --file <path> --note "<why>"\`.`;

/** A doctor reason (an unresolved row, a desync row) as a rule. */
export const reasonRule = (reason: string, level: SarifLevel): SarifRuleInfo => {
  const help = kindHint(reason) ?? genericHint(reason);
  return {
    id: reason,
    short: reasonShort(reason),
    help,
    helpMarkdown: `${help}\n\n${acceptLine(reason)}`,
    level,
    properties: { kind: kindOfRow({ reason }) },
  };
};

/** What each annotation check is about, in a few words and a sentence. */
export const MARKER_HELP: Readonly<Record<MarkerCode, readonly [short: string, help: string]>> = Object.freeze({
  'marker-emits-without-emit': ['@Emits on a method that publishes nothing', 'Remove the annotation, or publish from the method it is on.'],
  'marker-emits-shadowed': ['@Emits the code already says', 'Static reading finds this publish on its own; remove the annotation.'],
  'marker-consumes-without-consumer': ['@Consumes on a method nothing subscribes', 'Remove the annotation, or register the method as a handler.'],
  'marker-consumes-shadowed': ['@Consumes the code already says', 'Static reading finds this subscription on its own; remove the annotation.'],
  'marker-callsservice-unknown-service': ['@CallsService names no configured service', 'Add the service to services[], or to the aliases of the service it means, or correct the annotation.'],
  'marker-callsservice-route-missing': ['@CallsService names a route the service does not serve', 'Correct the route, or check the target service\'s controllers.'],
  'marker-callsservice-shadowed': ['@CallsService the code already says', 'The request is joined without it; remove the annotation.'],
  'marker-flowentry-not-handler': ['@FlowEntry on a method nothing enters through', 'Move it to the handler that starts the flow.'],
  'marker-contractignore-unused': ['@ContractIgnore on no boundary', 'Nothing here crosses a service boundary; remove it, or move it to the method that makes the call.'],
  'marker-unknown-arg': ['annotation argument that could not be read', 'Marker arguments must be string literals, or consts from a package listed in sharedPackages.'],
  'marker-arg-not-a-name': ['annotation argument that is not a name', 'Each argument must be a string or an array of strings.'],
  'marker-names-nothing': ['annotation that names nothing', 'Give it a name, a list of names, or several arguments.'],
});

export const markerRule = (code: string, level: SarifLevel): SarifRuleInfo => {
  const known = Object.hasOwn(MARKER_HELP, code) ? MARKER_HELP[code as MarkerCode] : undefined;
  return { id: code, short: known?.[0] ?? words(code), help: known?.[1] ?? genericHint(code), level };
};

/** What each contract disagreement is, and what to do about it. */
export const CONTRACT_HELP: Readonly<Record<FindingKind, readonly [short: string, help: string]>> = Object.freeze({
  missing_required: [
    'field the receiver requires and the sender does not send',
    'Send the field, or make it optional on the receiver. `flowatlas contracts --edge <key>` shows the boundary.',
  ],
  type_mismatch: [
    'field sent as a type the receiver does not expect',
    'Send the type the receiver declares, or change the declaration on the receiving side.',
  ],
  optionality_mismatch: [
    'field one side says is optional and the other requires',
    'Make the two declarations agree on whether the field can be left out.',
  ],
  extra_field: [
    'field the sender sends and the receiver does not declare',
    'Declare the field on the receiver, or stop sending it; a receiver that strips unknown fields never sees it.',
  ],
});

export const contractRule = (kind: string, level: SarifLevel): SarifRuleInfo => {
  const known = Object.hasOwn(CONTRACT_HELP, kind) ? CONTRACT_HELP[kind as FindingKind] : undefined;
  return { id: kind, short: known?.[0] ?? words(kind), help: known?.[1] ?? genericHint(kind), level };
};

/** The four things `dead` reports, as rules. */
export const DEAD_KINDS = ['dead-entry', 'dead-channel', 'dead-provider', 'dead-field'] as const;
export type DeadKind = (typeof DEAD_KINDS)[number];

const DEAD_HELP: Readonly<Record<DeadKind, readonly [short: string, help: string]>> = Object.freeze({
  'dead-entry': [
    'way in nothing in the project reaches',
    'Nothing in any configured repository calls it. A heuristic: it may be a public API, or called from a repository the configuration does not list; declare it in doctor.publicRoutes or dead.infrastructure, or remove it.',
  ],
  'dead-channel': [
    'channel with one end only',
    'Nothing publishes to it, or nothing consumes it, in any configured repository. Add the missing end, or remove the one that is there.',
  ],
  'dead-provider': [
    'provider nothing injects',
    'No class asks for it. An inject whose token could not be resolved may still reach it; the row says when the service has one.',
  ],
  'dead-field': [
    'field the receiving side removes',
    'The receiver strips the field before it is read, so the sender believes it sent something that never arrives. Declare it on the receiver, or stop sending it.',
  ],
});

export const deadRule = (kind: DeadKind): SarifRuleInfo => ({
  id: kind,
  short: DEAD_HELP[kind][0],
  help: DEAD_HELP[kind][1],
  level: 'note',
  properties: { precision: 'low' },
});

export const cycleRule = (): SarifRuleInfo => ({
  id: 'cycle',
  short: 'call cycle',
  help: 'A chain of calls, requests and triggers comes back to where it started. Across services it is a loop no single repository shows; break it where one side does not need the other.',
  level: 'warning',
});

/** A service the configuration lists whose code nothing enters (R170). */
export const noWayInRule = (): SarifRuleInfo => ({
  id: 'no-way-in',
  short: 'service with no way in',
  help: 'Its code was read and nothing in this graph reaches it, so no flow starts there. Check the service\'s type in flowatlas.config.json, or the reader that is meant to read it.',
  level: 'warning',
});

/** A P114 architecture rule, reported as `rule/<name>`. */
export const architectureRule = (
  rule: { rule: string; shape: string; note?: string },
  level: SarifLevel,
): SarifRuleInfo => ({
  id: `rule/${rule.rule}`,
  short: `architecture rule ${rule.rule} (${rule.shape})`,
  help:
    rule.note === undefined
      ? `The ${rule.shape} rule ${rule.rule} in flowatlas.config.json is broken. \`flowatlas rules --rule ${rule.rule}\` lists every violation.`
      : `${rule.note.replace(/\.+$/, '')}. \`flowatlas rules --rule ${rule.rule}\` lists every violation.`,
  level,
  properties: { shape: rule.shape },
});
