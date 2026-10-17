/**
 * Two revisions' documents compared operation by operation (P118).
 *
 * Routes are matched by what a request is matched on - the verb and the path
 * with its parameters as `:param` - so renaming a parameter is not a removed
 * route. Channel ends are matched by the operation's key, then by the action
 * and the channel. Each pair is compared part by part: the request body and
 * values, the success answer, the failure statuses, the guards; a payload for
 * a channel. Every change is one kind of `SPEC_CHANGE_KINDS`, with the
 * callers joined to it on the base side, and its level follows from them
 * (D2): a breaking change with no caller and no public mark is a warning.
 */
import type { Confidence } from '@flowatlas/core';
import { weakest } from '../analysis/graph.js';
import type { TypeFieldChange } from '../diff/types.js';
import { cmp, type SpecCaller, type SpecOperation, type WrittenSpec } from '../document/written.js';
import type { JsonSchema } from '../document/write-shapes.js';
import { compareSchemas, schemaSaid } from './compare.js';
import {
  NO_CALLER_NOTE,
  SPEC_CHANGE_KINDS,
  SPEC_CHANGE_LEVELS,
  SPEC_DIFF_FORMAT_VERSION,
  type SpecChange,
  type SpecChangeKind,
  type SpecDiffReport,
} from './types.js';

export interface SpecDiffOptions {
  /**
   * Who is joined to an operation on the base side. The callers each written
   * operation carries by default; a caller that reads them elsewhere passes
   * its own.
   */
  callers?: (operation: SpecOperation) => SpecCaller[];
  /** How far into nested shapes fields are compared. */
  depth?: number;
}

type Part = 'request' | 'response' | 'message';

/** Which kind a field-level change is, by which way the data flows. */
const KIND_OF: Readonly<Record<Part, (change: TypeFieldChange) => SpecChangeKind | undefined>> = {
  request: (change) => {
    if (change.change === 'added') return change.optional ? 'optional-property-added' : 'request-property-added-required';
    if (change.change === 'removed') return 'request-property-removed';
    if (change.change === 'optionality') return change.optional ? undefined : 'request-property-became-required';
    return 'request-property-type-changed';
  },
  response: (change) => {
    if (change.change === 'added') return change.optional ? 'optional-property-added' : undefined;
    if (change.change === 'removed') return 'response-property-removed';
    if (change.change === 'optionality') return change.optional ? 'response-property-became-optional' : undefined;
    return 'response-property-type-changed';
  },
  message: (change) => {
    if (change.change === 'added') return change.optional ? 'optional-property-added' : undefined;
    if (change.change === 'removed') return 'message-property-removed';
    if (change.change === 'optionality') return change.optional ? 'message-property-became-optional' : undefined;
    return 'message-property-type-changed';
  },
};

const at = (document: Record<string, unknown>, pointer: readonly string[]): Record<string, unknown> | undefined => {
  let found: unknown = document;
  for (const step of pointer) {
    if (found === null || typeof found !== 'object') return undefined;
    found = (found as Record<string, unknown>)[step];
  }
  return found !== null && typeof found === 'object' ? (found as Record<string, unknown>) : undefined;
};

const jsonOf = (holder: unknown): JsonSchema | undefined =>
  ((holder as { content?: Record<string, { schema?: JsonSchema }> } | undefined)?.content?.['application/json']?.schema);

/** A route's parts as the comparison reads them. */
interface RouteParts {
  body: JsonSchema | undefined;
  parameters: Map<string, { required: boolean; schema: JsonSchema | undefined }>;
  responses: Record<string, Record<string, unknown>>;
  guards: string[];
}

const routeParts = (operation: Record<string, unknown>): RouteParts => {
  const parameters = new Map<string, { required: boolean; schema: JsonSchema | undefined }>();
  for (const parameter of (operation['parameters'] as Array<Record<string, unknown>> | undefined) ?? []) {
    const place = parameter['in'] === 'header' ? 'header' : parameter['in'] === 'query' ? 'query' : 'path';
    // Path parameters are matched by position: their names are not on the wire.
    const name = place === 'path' ? `path.${parameters.size}` : `${place}.${String(parameter['name'])}`;
    parameters.set(name, { required: parameter['required'] === true, schema: parameter['schema'] as JsonSchema | undefined });
  }
  return {
    body: jsonOf(operation['requestBody']),
    parameters,
    responses: (operation['responses'] as Record<string, Record<string, unknown>> | undefined) ?? {},
    guards: ((operation['x-flowatlas-guards'] as Array<{ name?: unknown }> | undefined) ?? []).map((guard) => String(guard.name)),
  };
};

/** What each change needs to know about its operation, beside the change itself. */
interface Context {
  spec: WrittenSpec;
  operation: SpecOperation;
  head?: SpecOperation;
  callers: SpecCaller[];
  /** Which side `operation` is on: the base side, but for an added one. */
  side?: 'base' | 'head';
}

const make = (
  context: Context,
  kind: SpecChangeKind,
  field: string | null,
  values: { base: string | null; head: string | null },
  message: string,
): SpecChange => {
  const catalogued = SPEC_CHANGE_KINDS[kind].level;
  const uncalled = catalogued === 'error' && context.callers.length === 0 && context.operation.public === undefined;
  const levels: Confidence[] = [context.operation.confidence, ...(context.head === undefined ? [] : [context.head.confidence])];
  return {
    kind,
    level: uncalled ? 'warning' : catalogued,
    document: context.spec.name,
    format: context.spec.kind,
    service: context.spec.service,
    operation: context.operation.key,
    field,
    base: values.base,
    head: values.head,
    message: `${context.operation.key}: ${message}${uncalled ? ` (${NO_CALLER_NOTE})` : ''}`,
    place:
      context.operation.file === undefined
        ? null
        : { side: context.side ?? 'base', file: context.operation.file, ...(context.operation.line === undefined ? {} : { line: context.operation.line }) },
    callers: context.callers,
    public: context.operation.public ?? null,
    note: uncalled ? NO_CALLER_NOTE : null,
    confidence: weakest(levels),
    key: `${kind}|${context.spec.name}|${context.operation.key}|${field ?? ''}`,
  };
};

const fieldChanges = (context: Context, part: Part, changes: readonly TypeFieldChange[]): SpecChange[] =>
  changes.flatMap((change) => {
    const kind = KIND_OF[part](change);
    return kind === undefined ? [] : [make(context, kind, change.field, { base: change.base, head: change.head }, change.message)];
  });

const isSuccess = (status: string): boolean => /^2/.test(status);

/** Two routes on the same verb, the head's path the base's with parameters put in. */
const paramsAdded = (base: string, head: string): boolean => {
  const [bv, bp = ''] = base.split(/:(.*)/s);
  const [hv, hp = ''] = head.split(/:(.*)/s);
  if (bv !== hv) return false;
  const bs = bp.split('/').filter(Boolean);
  const hs = hp.split('/').filter(Boolean);
  if (hs.length <= bs.length) return false;
  let i = 0;
  for (const segment of hs) {
    if (i < bs.length && segment === bs[i]) i += 1;
    else if (segment !== ':param') return false;
  }
  return i === bs.length;
};

const compareRoutes = (context: Context, base: WrittenSpec, head: WrittenSpec, depth: number): SpecChange[] => {
  const headOperation = context.head as SpecOperation;
  const was = at(base.document, context.operation.pointer);
  const now = at(head.document, headOperation.pointer);
  if (was === undefined || now === undefined) return [];
  const b = routeParts(was);
  const h = routeParts(now);
  const found: SpecChange[] = [];
  const sides = (left: JsonSchema | undefined, right: JsonSchema | undefined) => [
    { document: base.document, schema: left },
    { document: head.document, schema: right },
  ] as const;

  if (b.body === undefined && h.body !== undefined) {
    found.push(make(context, 'request-property-added-required', 'body', { base: null, head: schemaSaid(head.document, h.body) }, 'the request now takes a body, which callers on the base side do not send'));
  } else if (b.body !== undefined && h.body === undefined) {
    found.push(make(context, 'request-property-removed', 'body', { base: schemaSaid(base.document, b.body), head: null }, 'the request takes no body any more; callers still send one'));
  } else if (b.body !== undefined && h.body !== undefined) {
    found.push(...fieldChanges(context, 'request', compareSchemas(...sides(b.body, h.body), 'body', depth)));
  }

  for (const [name, param] of h.parameters) {
    const before = b.parameters.get(name);
    if (before === undefined) {
      found.push(make(context, param.required ? 'request-property-added-required' : 'optional-property-added', name, { base: null, head: schemaSaid(head.document, param.schema) }, `head reads \`${name}\`${param.required ? ' and requires it' : ''}; base did not`));
      continue;
    }
    if (param.required && !before.required) {
      found.push(make(context, 'request-property-became-required', name, { base: schemaSaid(base.document, before.schema), head: schemaSaid(head.document, param.schema) }, `\`${name}\` could be left out in base and is required in head`));
    }
    found.push(...fieldChanges(context, 'request', compareSchemas(...sides(before.schema, param.schema), name, depth)));
  }
  for (const [name, param] of b.parameters) {
    if (h.parameters.has(name)) continue;
    found.push(make(context, 'request-property-removed', name, { base: schemaSaid(base.document, param.schema), head: null }, `head no longer reads \`${name}\`; callers may still send it`));
  }

  for (const status of Object.keys(b.responses).filter(isSuccess)) {
    if (Object.hasOwn(h.responses, status)) {
      found.push(...fieldChanges(context, 'response', compareSchemas(...sides(jsonOf(b.responses[status]), jsonOf(h.responses[status])), 'response', depth)));
      continue;
    }
    const replaced = Object.keys(h.responses).filter(isSuccess);
    found.push(make(context, 'response-status-removed', `status ${status}`, { base: status, head: replaced.join(', ') || null }, `success status ${status} is no longer answered${replaced.length === 0 ? '' : ` (head answers ${replaced.join(', ')})`}`));
  }
  for (const status of Object.keys(h.responses).filter((key) => !isSuccess(key))) {
    const before = b.responses[status];
    const description = String(h.responses[status]?.['description'] ?? '');
    if (before === undefined) {
      found.push(make(context, 'response-status-added', `status ${status}`, { base: null, head: description }, `it can now fail with ${status} (${description}), which callers may not handle`));
      continue;
    }
    if (String(before['description'] ?? '') !== description) {
      found.push(make(context, 'description-changed', `status ${status}`, { base: String(before['description'] ?? ''), head: description }, `what ${status} is answered for changed`));
    }
  }

  const added = h.guards.filter((guard) => !b.guards.includes(guard));
  if (added.length > 0) {
    found.push(make(context, 'security-added', 'guards', { base: b.guards.join(', ') || null, head: h.guards.join(', ') }, `${added.join(', ')} now stand${added.length === 1 ? 's' : ''} in front of it`));
  }
  return found;
};

const compareMessages = (context: Context, base: WrittenSpec, head: WrittenSpec, depth: number): SpecChange[] => {
  if (context.operation.kind !== 'send') return [];
  const payloadOf = (spec: WrittenSpec, operation: SpecOperation): JsonSchema | undefined => {
    const written = at(spec.document, operation.pointer);
    const message = (written?.['messages'] as Array<{ $ref?: string }> | undefined)?.[0]?.$ref?.split('/').pop();
    const messages = (spec.document['components'] as { messages?: Record<string, { payload?: JsonSchema }> } | undefined)?.messages;
    return message === undefined ? undefined : messages?.[message]?.payload;
  };
  const was = payloadOf(base, context.operation);
  const now = payloadOf(head, context.head as SpecOperation);
  if (was === undefined || now === undefined) return [];
  return fieldChanges(context, 'message', compareSchemas({ document: base.document, schema: was }, { document: head.document, schema: now }, 'payload', depth));
};

const removedKind = (operation: SpecOperation, head: WrittenSpec | undefined): SpecChangeKind => {
  if (operation.kind === 'send') return 'channel-removed';
  if (operation.kind === 'receive') return 'channel-consumer-removed';
  const path = (operation.route ?? '').slice((operation.route ?? '').indexOf(':') + 1);
  const pathStays = (head?.operations ?? []).some((other) => other.route !== undefined && other.route.slice(other.route.indexOf(':') + 1) === path);
  return pathStays ? 'method-removed' : 'endpoint-removed';
};

const REMOVED_SAID: Readonly<Record<string, string>> = {
  'channel-removed': 'this service no longer publishes there',
  'channel-consumer-removed': 'this service no longer handles what is published there',
  'method-removed': 'the path no longer answers this verb',
  'endpoint-removed': 'the route is gone',
};

/** Match head operations to base ones: by key, then a channel end by action and channel. */
const pairOperations = (base: WrittenSpec, head: WrittenSpec | undefined): { pairs: Array<[SpecOperation, SpecOperation]>; removed: SpecOperation[]; added: SpecOperation[] } => {
  const identity = (operation: SpecOperation): string => (operation.kind === 'http' ? `http|${operation.route ?? operation.key}` : operation.key);
  const open = new Map((head?.operations ?? []).map((operation) => [identity(operation), operation]));
  const pairs: Array<[SpecOperation, SpecOperation]> = [];
  const unmatched: SpecOperation[] = [];
  for (const operation of base.operations) {
    const found = open.get(identity(operation));
    if (found === undefined) {
      unmatched.push(operation);
      continue;
    }
    open.delete(identity(operation));
    pairs.push([operation, found]);
  }
  const removed: SpecOperation[] = [];
  for (const operation of unmatched) {
    const same = [...open.values()].filter((other) =>
      operation.kind === 'http'
        ? other.kind === 'http' && paramsAdded(operation.route ?? '', other.route ?? '')
        : other.kind === operation.kind && other.channel === operation.channel,
    );
    if (same.length === 1) {
      open.delete(identity(same[0] as SpecOperation));
      pairs.push([operation, same[0] as SpecOperation]);
      continue;
    }
    removed.push(operation);
  }
  return { pairs, removed, added: [...open.values()] };
};

const LEVEL_RANK = new Map(SPEC_CHANGE_LEVELS.map((level, rank) => [level, rank]));

/**
 * Every change from the base side's documents to the head side's, sorted by
 * level, document, operation, field and kind.
 */
export const diffSpecs = (base: readonly WrittenSpec[], head: readonly WrittenSpec[], options: SpecDiffOptions = {}): SpecDiffReport => {
  const callersOf = options.callers ?? ((operation: SpecOperation) => operation.callers);
  const depth = options.depth ?? 8;
  const identity = (spec: WrittenSpec): string => `${spec.kind}|${spec.name}`;
  const heads = new Map(head.map((spec) => [identity(spec), spec]));
  const changes: SpecChange[] = [];

  for (const spec of base) {
    const other = heads.get(identity(spec));
    heads.delete(identity(spec));
    const { pairs, removed, added } = pairOperations(spec, other);
    for (const operation of removed) {
      const kind = removedKind(operation, other);
      changes.push(make({ spec, operation, callers: callersOf(operation) }, kind, null, { base: operation.key, head: null }, REMOVED_SAID[kind] ?? 'removed'));
    }
    for (const operation of added) {
      changes.push(make({ spec: other as WrittenSpec, operation, callers: [], side: 'head' }, 'endpoint-added', null, { base: null, head: operation.key }, 'added on the head side'));
    }
    for (const [was, now] of pairs) {
      const context: Context = { spec, operation: was, head: now, callers: callersOf(was) };
      if (was.route !== undefined && now.route !== undefined && was.route !== now.route) {
        changes.push(make(context, 'path-param-added', null, { base: was.key, head: now.key }, `the path is now ${now.key.slice(now.key.indexOf(' ') + 1)}`));
        continue;
      }
      changes.push(...(was.kind === 'http' ? compareRoutes(context, spec, other as WrittenSpec, depth) : compareMessages(context, spec, other as WrittenSpec, depth)));
    }
  }
  for (const spec of heads.values()) {
    for (const operation of spec.operations) {
      changes.push(make({ spec, operation, callers: [], side: 'head' }, 'endpoint-added', null, { base: null, head: operation.key }, 'added on the head side'));
    }
  }

  changes.sort(
    (a, b) =>
      (LEVEL_RANK.get(a.level) ?? 0) - (LEVEL_RANK.get(b.level) ?? 0) ||
      cmp(a.document, b.document) ||
      cmp(a.operation, b.operation) ||
      cmp(a.field ?? '', b.field ?? '') ||
      cmp(a.kind, b.kind),
  );
  const level = (wanted: string): number => changes.filter((change) => change.level === wanted).length;
  return {
    specDiffFormatVersion: SPEC_DIFF_FORMAT_VERSION,
    documents: { base: base.length, head: head.length },
    changes,
    summary: {
      errors: level('error'),
      warnings: level('warning'),
      infos: level('info'),
      breaking: changes.filter((change) => SPEC_CHANGE_KINDS[change.kind].level === 'error').length,
      uncalled: changes.filter((change) => change.note === NO_CALLER_NOTE).length,
    },
  };
};

/** The changes at or above a level, which is what `--fail-on` fails on. */
export const SPEC_FAIL_LEVELS = ['none', 'error', 'warning'] as const;
export type SpecFailLevel = (typeof SPEC_FAIL_LEVELS)[number];

export const specFailures = (report: SpecDiffReport, failOn: SpecFailLevel): SpecChange[] =>
  failOn === 'none' ? [] : report.changes.filter((change) => change.level === 'error' || (failOn === 'warning' && change.level === 'warning'));
