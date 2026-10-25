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

/** Version of `spec-diff.json` (and of `diff.json`'s `spec`), independent of every other format. */
export const SPEC_DIFF_FORMAT_VERSION = 1;

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
}
