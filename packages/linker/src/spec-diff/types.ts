/**
 * What changed between two revisions' API documents, sorted into a fixed
 * catalogue of kinds (P118, D4), modelled on oasdiff's: the names are used as
 * SARIF `ruleId`s and documented, so they do not change.
 *
 * What a document differ cannot say and this does is who each change breaks:
 * every change carries the callers joined to it on the base side - requests
 * to a route, consumers of what a service sends, publishers of what it
 * receives - and a breaking change nobody in the project calls, on a route
 * nobody marked public, is a warning saying so rather than an error (D2).
 */
import type { Confidence } from '@flowatlas/core';
import type { SpecCaller, SpecKind } from '../document/written.js';

/**
 * Version of `spec-diff.json` (and of `diff.json`'s `spec`), independent of
 * every other format. 2 (P390): a change may carry `use`, the report
 * `coverage`.
 */
export const SPEC_DIFF_FORMAT_VERSION = 2;

/** The file `flowatlas spec diff` leaves beside the graph, whatever it printed. */
export const SPEC_DIFF_FILE = 'spec-diff.json';

export const SPEC_CHANGE_LEVELS = ['error', 'warning', 'info'] as const;
export type SpecChangeLevel = (typeof SPEC_CHANGE_LEVELS)[number];

/** What each kind of change is, at the level it has before callers are counted. */
export interface SpecChangeKindInfo {
  level: SpecChangeLevel;
  /** A few words, for a heading or a SARIF rule's short description. */
  short: string;
  /** What to do about it, for the report and SARIF help. */
  help: string;
}

/**
 * The catalogue. `breaking` kinds fail a caller that worked on the base side;
 * `warning` kinds may; `info` kinds cannot.
 * `message-property-became-optional` is beyond the ticket's list: a message
 * field consumers read that the publisher may now leave out breaks them the
 * way the response kind of it does.
 */
export const SPEC_CHANGE_KINDS = {
  'endpoint-removed': { level: 'error', short: 'route removed', help: 'Every request to it now fails. Keep the route, or move its callers first.' },
  'method-removed': { level: 'error', short: 'verb removed from a path', help: 'The path still answers other verbs, not this one. Keep the verb, or move its callers first.' },
  'path-param-added': { level: 'error', short: 'path parameter added', help: 'A request written for the old path no longer matches. Give the new parameter its own route, or move the callers.' },
  'request-property-became-required': { level: 'error', short: 'request field now required', help: 'A caller that leaves it out is refused. Keep it optional, or have every caller send it first.' },
  'request-property-added-required': { level: 'error', short: 'required request field added', help: 'Callers written for the base side do not send it. Make it optional, or have every caller send it first.' },
  'request-property-type-changed': { level: 'error', short: 'request field type changed', help: 'Callers send the old type. Accept both, or change the callers with it.' },
  'response-property-removed': { level: 'error', short: 'response field removed', help: 'Callers that read it get nothing. Keep sending it, or change the callers first.' },
  'response-property-type-changed': { level: 'error', short: 'response field type changed', help: 'Callers read the old type. Keep the old type, or change the callers with it.' },
  'response-property-became-optional': { level: 'error', short: 'response field may now be absent', help: 'Callers that read it may get nothing. Keep sending it, or make the callers cope.' },
  'response-status-removed': { level: 'error', short: 'success status removed', help: 'Callers that wait for this success status no longer get it. Keep the status, or change the callers.' },
  'channel-removed': { level: 'error', short: 'publish removed', help: 'Consumers of the channel get nothing from this service any more. Keep publishing, or move the consumers first.' },
  'message-property-removed': { level: 'error', short: 'message field removed', help: 'Consumers that read it get nothing. Keep sending it, or change the consumers first.' },
  'message-property-type-changed': { level: 'error', short: 'message field type changed', help: 'Consumers read the old type. Keep the old type, or change the consumers with it.' },
  'message-property-became-optional': { level: 'error', short: 'message field may now be absent', help: 'Consumers that read it may get nothing. Keep sending it, or make the consumers cope.' },
  'request-property-removed': { level: 'warning', short: 'request field removed', help: 'Callers still send it and it lands nowhere. Remove it from the callers.' },
  'response-status-added': { level: 'warning', short: 'failure status added', help: 'A caller may not handle the new status. Check that each caller does.' },
  'security-added': { level: 'warning', short: 'guard added', help: 'A check now stands in front of the route; callers without what it asks for are refused. Check each caller has it.' },
  'channel-consumer-removed': { level: 'warning', short: 'consumer removed', help: 'What is published on the channel is no longer handled here. Check nothing still depends on this service handling it.' },
  'endpoint-added': { level: 'info', short: 'route or channel end added', help: 'Nothing that worked before can break.' },
  'optional-property-added': { level: 'info', short: 'optional field added', help: 'Nothing that worked before can break.' },
  'description-changed': { level: 'info', short: 'description changed', help: 'Nothing that worked before can break.' },
} as const satisfies Record<string, SpecChangeKindInfo>;

export type SpecChangeKind = keyof typeof SPEC_CHANGE_KINDS;

/** The kinds, in catalogue order. */
export const SPEC_CHANGE_KIND_NAMES = Object.keys(SPEC_CHANGE_KINDS) as SpecChangeKind[];

/** What a breaking change with no caller and no public mark says instead of failing (D2). */
export const NO_CALLER_NOTE = 'no caller in this project';

/** One change, at the level its callers give it. */
export interface SpecChange {
  kind: SpecChangeKind;
  /** The level after callers were counted: a breaking change nobody calls is a warning. */
  level: SpecChangeLevel;
  /** The document: `orders`, `orders@admin`. */
  document: string;
  format: SpecKind;
  service: string;
  /** `POST /orders/{id}`, `send order.created`. */
  operation: string;
  /** `body.channel`, `query.page`, `response.total`, `status 404`; null for the operation as a whole. */
  field: string | null;
  base: string | null;
  head: string | null;
  message: string;
  /**
   * Where the operation is read from: on the base side for what changed or
   * went, on the head side for what was added. A file inside the service's
   * repository.
   */
  place: { side: 'base' | 'head'; file: string; line?: number } | null;
  /** The callers joined to it on the base side, nearest first. */
  callers: SpecCaller[];
  /** Why the route is open on purpose, on the base side. */
  public: string | null;
  /** Set when a breaking change was made a warning because nobody calls it: `NO_CALLER_NOTE`. */
  note: string | null;
  /** The weaker of what the two sides were read with (I4). */
  confidence: Confidence;
  /** `kind|document|operation|field`, what a baseline and a SARIF fingerprint key on. */
  key: string;
  /**
   * What the change does to the code that uses it (P390), read off both
   * sides' graphs: set by `diff --spec` and `spec diff`, never by a document
   * comparison alone. `level` is then `use.level`.
   */
  use?: SpecChangeUse;
}

/**
 * Which way a change moves a contract (oasdiff's model, P390): narrowing what
 * a route accepts or widening what it answers or a message carries breaks the
 * other end (`breaking`); the reverse cannot (`compatible`); what neither side
 * settles - a field the receiver stops reading, which a validator may drop or
 * refuse - is `unconfirmed`.
 */
export const SPEC_CHANGE_DIRECTIONS = ['breaking', 'compatible', 'unconfirmed'] as const;
export type SpecChangeDirection = (typeof SPEC_CHANGE_DIRECTIONS)[number];

/**
 * What one consumer does with what changed: `reads` the field, `sends` it,
 * `omits` a field now required, `joined` (it calls the route or takes the
 * message at all), `opaque` (the value reaches it whole: spread, forwarded,
 * handed outside the repository), `unread` (it was not read for the fields it
 * reads), `unknown` (what it reads of this part is not read at all, as a
 * response's fields are not yet), `ignores` (read whole, and it neither reads
 * nor sends what changed).
 */
export const SPEC_USE_HOWS = ['reads', 'sends', 'omits', 'joined', 'opaque', 'unread', 'unknown', 'ignores'] as const;
export type SpecUseHow = (typeof SPEC_USE_HOWS)[number];

/** One consumer of a change, with what it does with it and where. */
export interface SpecUseReader {
  /** The consumer, the request or the publisher, as `callers` names it. */
  id: string;
  service: string;
  file?: string;
  line?: number;
  how: SpecUseHow;
  /** A few words: "reads `label`, line 16", "sends name, price; no `currency`". */
  said: string;
  /** The level this consumer alone gives the change. */
  level: SpecChangeLevel;
}

/** The steps of a flow, as `use.flows` names them, from the way in to the consumer. */
export const SPEC_FLOW_STEPS = ['way in', 'code', 'request', 'route', 'handler', 'publish', 'channel', 'consumer'] as const;
export type SpecFlowStepKind = (typeof SPEC_FLOW_STEPS)[number];

/** One step of a flow across repositories: way in -> client call -> route -> handler -> publish -> consumer. */
export interface SpecFlowStep {
  id: string;
  step: SpecFlowStepKind;
  label: string;
  service: string;
  file?: string;
  line?: number;
}

/**
 * Where a change is placed on the head side (P390), since a pull request is
 * annotated only on lines it holds: the operation's own line where it
 * survives (`same`), the nearest line of its file that survives where it
 * went (`nearest`, `from` the line it had), or no line at all where the file
 * went too (`summary`: said with the summary, never on a guessed line).
 */
export interface SpecAnchor {
  how: 'same' | 'nearest' | 'summary';
  file?: string;
  line?: number;
  from?: { file: string; line?: number };
}

/** The order to deploy a change in, so no consumer meets it before it can: who goes first, and why. */
export interface SpecDeployOrder {
  first: 'consumers' | 'producers' | 'callers' | 'server';
  said: string;
}

/** What a change does to the code that uses it (P390). */
export interface SpecChangeUse {
  direction: SpecChangeDirection;
  /** Why the direction is what it is, in a few words. */
  why: string;
  /**
   * The level from use: `error` when a joined consumer reads the field,
   * sends one now invalid or omits one now required; `info` when no consumer
   * reads it, among `among`; `warning` where one reaches it opaquely or what
   * it reads is not known.
   */
  level: SpecChangeLevel;
  /** One line: "1 of 1 caller omits `currency`", "no consumer reads it, among 2". */
  verdict: string;
  /** The consumers counted: the callers on the base side. */
  among: number;
  /** Each consumer and what it does with the change, the loudest first. */
  readers: SpecUseReader[];
  /** Flows from a way in to the consumers it breaks or may break, across repositories; at most three. */
  flows: SpecFlowStep[][];
  deployOrder?: SpecDeployOrder;
  anchor?: SpecAnchor;
}

/** What a usage verdict could see (P390): the consumers it counted, in the repositories read. */
export interface SpecCoverage {
  consumers: number;
  repositories: number;
  /** "3 consumers in 5 repositories; consumers outside them unknown". */
  said: string;
}

export interface SpecDiffSummary {
  errors: number;
  warnings: number;
  infos: number;
  /** Breaking by the catalogue, before callers were counted. */
  breaking: number;
  /** Breaking by the catalogue and a warning because nobody calls it. */
  uncalled: number;
}

/** `spec-diff.json`, and `diff.json`'s `spec` with `--spec`. */
export interface SpecDiffReport {
  specDiffFormatVersion: number;
  /** How many documents each side wrote. */
  documents: { base: number; head: number };
  changes: SpecChange[];
  summary: SpecDiffSummary;
  /** With usage verdicts (P390): the consumers counted and where; consumers outside them are unknown. */
  coverage?: SpecCoverage;
}
