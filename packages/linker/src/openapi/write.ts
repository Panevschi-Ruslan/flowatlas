/**
 * An OpenAPI 3.1 document of one service's routes, written from the graph
 * (P118): the inverse of `read.ts`.
 *
 * Everything in it is something the graph already read - the paths and
 * verbs, the names of the path's parameters (P34), the query and header
 * values the handler reads (P29), the body and the answer from the type
 * registry with the wire rules applied (D1), the failures (P68, P87, P90) and
 * the guards in front (P76). What could not be read is left out and counted,
 * or written as `{}` with the reason (I3); nothing is a guess written as
 * fact. Each operation also says where it was read (`x-flowatlas-source`),
 * how surely (`x-flowatlas-confidence`, I4), and who in the project calls it
 * (`x-flowatlas-callers`), which is what no document written by hand has.
 *
 * Frameworks are not named here (I1): the reading of each one already wrote
 * the same keys on the entry and its `handles` edge, and this reads those.
 */
import type { GraphLookup } from '@flowatlas/contracts';
import {
  accessOf,
  CLAIMED_META,
  failuresOf,
  formatTypeRef,
  groupFailures,
  parseTypeRef,
  PARAM_PLACEHOLDER,
  REQUEST_READ_META,
  STATUS_UNKNOWN_META,
  FAILURES_META,
  wasRead,
  type Confidence,
  type FailureGroup,
  type GraphEdge,
  type GraphNode,
  type TypeField,
} from '@flowatlas/core';
import { weakest } from '../analysis/graph.js';
import {
  applicationOf,
  callersBy,
  cmp,
  count,
  publicOf,
  routeCallers,
  serviceNodes,
  sortedRecord,
  sourceOf,
  SPEC_VERSION_SAID,
  type SpecOperation,
  type SpecOptions,
  type WrittenSpec,
} from '../document/written.js';
import { shapeWriter, unreadCounts, UNREAD_KEY, type JsonSchema, type ShapeRoot } from '../document/write-shapes.js';

/** The version of the specification written. */
export const OPENAPI_VERSION = '3.1.0';

/** The one media type a body is written under: the registry describes JSON. */
const JSON_MEDIA = 'application/json';

/** The answer a route gives when it succeeds, when no reader said which status: any 2xx. */
const SUCCESS = '2XX';

/** Verbs as a path item spells them, in the order they are written. */
const VERB_KEYS: ReadonlyArray<[string, string]> = [
  ['GET', 'get'],
  ['PUT', 'put'],
  ['POST', 'post'],
  ['DELETE', 'delete'],
  ['OPTIONS', 'options'],
  ['HEAD', 'head'],
  ['PATCH', 'patch'],
];
const VERB_KEY = new Map(VERB_KEYS);
const VERB_RANK = new Map(VERB_KEYS.map(([, key], at) => [key, at]));

/** References that say nothing is carried. */
const NOTHING = new Set(['void', 'undefined', 'never']);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** `:id`, `{id}`, `{id+}`, `[id]`, `[...slug]`, `<id>`: a hole as a route spells it, and its name. */
const HOLE = /^(?::([A-Za-z_$][\w$]*)\??|\{([A-Za-z_$][\w$]*)\+?\}|\[(?:\.\.\.)?([A-Za-z_$][\w$]*)\]|<([A-Za-z_$][\w$]*)>)$/;

/**
 * The path as a document templates it, and its parameters' names.
 *
 * The id's path (`/orders/:param`) is what a request is matched on, so it is
 * the shape written; each `:param` takes its name from the path as written at
 * the registration (P34), segment by segment. A route whose two paths do not
 * line up takes names from what a document declared, or is numbered - and a
 * numbered name says so, since it is not one the code wrote.
 */
const templateOf = (entry: GraphNode, path: string): { template: string; names: Array<{ name: string; read: boolean }> } => {
  const segments = path.split('/').filter((segment) => segment !== '');
  const raw = (text(entry.meta?.['rawPath']) ?? '').split('/').filter((segment) => segment !== '');
  const declared = Array.isArray(entry.meta?.['pathParams']) ? (entry.meta['pathParams'] as unknown[]).filter((name): name is string => typeof name === 'string') : [];
  const names: Array<{ name: string; read: boolean }> = [];
  const used = new Set<string>();
  let hole = 0;
  const written = segments.map((segment, at) => {
    if (segment !== PARAM_PLACEHOLDER) return segment;
    const match = raw.length === segments.length ? HOLE.exec(raw[at] ?? '') : null;
    const found = match === null ? declared[hole] : (match[1] ?? match[2] ?? match[3] ?? match[4]);
    hole += 1;
    let name = found ?? `param${hole}`;
    for (let n = 2; used.has(name); n += 1) name = `${found ?? 'param'}${n}`;
    used.add(name);
    names.push({ name, read: found !== undefined });
    return `{${name}}`;
  });
  return { template: `/${written.join('/')}`, names };
};

/** The fields of a reference that names an object: written out, or registered. */
const fieldsOfRef = (lookup: GraphLookup, ref: string | undefined): TypeField[] | undefined => {
  if (ref === undefined) return undefined;
  let ast;
  try {
    ast = parseTypeRef(ref);
  } catch {
    return undefined;
  }
  if (ast.kind === 'object') return ast.fields.map((field) => ({ name: field.name, optional: field.optional, type: formatTypeRef(field.type) }));
  if (ast.kind !== 'id' || ast.args !== undefined) return undefined;
  const entry = lookup.type(ast.id);
  return entry?.kind === 'object' ? entry.fields : undefined;
};

/** The one `handles` edge a route is answered through, and whether there was a choice. */
const handlesOf = (lookup: GraphLookup, entry: GraphNode): { edge: GraphEdge | undefined; several: boolean } => {
  const edges = lookup.edgesFrom(entry.id, ['handles']).sort((a, b) => cmp(a.to, b.to));
  const read = edges.find((edge) => edge.meta?.[REQUEST_READ_META] === true) ?? edges[0];
  return { edge: read, several: edges.length > 1 };
};

/**
 * The body a handler is given, when it says one.
 *
 * Where the reading put it, under `body`. A handler whose reading recorded no
 * part of the request may still take one shape, and that is a body only when
 * it names a declared or written-out object: a lone `string` is a path value
 * as often as a body, and calling it a body would invent one (I3).
 */
const bodyOf = (handles: GraphEdge | undefined): string | undefined => {
  const meta = handles?.meta ?? {};
  const said = text(meta['body']);
  if (said !== undefined) return said;
  if (meta[REQUEST_READ_META] === true || ['params', 'query', 'headers'].some((part) => meta[part] !== undefined)) return undefined;
  const named = (handles?.params ?? []).filter((param) => param.startsWith('type:') || param.startsWith('{'));
  return named.length === 1 ? named[0] : undefined;
};

const claimed = (handles: GraphEdge | undefined, part: string): boolean => {
  const said = handles?.meta?.[CLAIMED_META];
  return Array.isArray(said) && said.includes(part);
};

/** A response's description and what it carries, per status. */
interface Answer {
  exceptions: string[];
  assumed: boolean;
  sources: Set<string>;
  ref?: string;
}

/**
 * The statuses a route fails with, one response each (P87, P90).
 *
 * A group with a status answers under it; a helper's choices answer under
 * each status they can choose, the helper named beside each class; a group
 * with neither is the `default` response, its status said to be unread. A
 * status every site of which is assumed says so (`x-flowatlas-assumed`).
 */
const failureAnswers = (groups: readonly FailureGroup[], sent: Readonly<Record<string, string>>): Map<string, Answer> => {
  const answers = new Map<string, Answer>();
  const add = (status: string, exception: string, assumed: boolean, sources: readonly string[]): void => {
    const answer = answers.get(status) ?? { exceptions: [], assumed: true, sources: new Set<string>() };
    if (!answer.exceptions.includes(exception)) answer.exceptions.push(exception);
    answer.assumed &&= assumed;
    for (const source of sources) answer.sources.add(source);
    answers.set(status, answer);
  };
  for (const group of groups) {
    if (group.status !== undefined) {
      add(String(group.status), group.exception, group.assumed === true, group.sources);
      continue;
    }
    const choices = (group.chosenFrom ?? []).filter((choice) => choice.status !== undefined);
    if (choices.length === 0) {
      add('default', group.exception, false, group.sources);
      continue;
    }
    for (const choice of choices) add(String(choice.status), `${choice.exception} (through ${group.exception})`, choice.assumed === true || group.assumed === true, group.sources);
  }
  for (const [status, ref] of Object.entries(sent)) {
    const answer = answers.get(status) ?? { exceptions: [], assumed: false, sources: new Set<string>() };
    answer.ref = ref;
    answers.set(status, answer);
  }
  return answers;
};

/** Responses in the order a reader reads them: success, failures by status, then the unread. */
const responseOrder = (a: string, b: string): number => {
  const rank = (key: string): number => (key === SUCCESS ? 0 : key === 'default' ? 2 : 1);
  return rank(a) - rank(b) || cmp(a, b);
};

/** One route, ready to write once every shape is known. */
interface Planned {
  entry: GraphNode;
  verb: string;
  key: string;
  template: string;
  names: Array<{ name: string; read: boolean }>;
  handles: GraphEdge | undefined;
  several: boolean;
  handler: GraphNode | undefined;
}

const planRoutes = (lookup: GraphLookup, entries: readonly GraphNode[], omitted: Record<string, number>): Planned[] => {
  const planned: Planned[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const path = text(entry.meta?.['path']);
    const method = text(entry.meta?.['method'])?.toUpperCase();
    if (path === undefined || method === undefined || !wasRead(path)) {
      count(omitted, 'path-unread');
      continue;
    }
    const verb = VERB_KEY.get(method);
    if (verb === undefined) {
      count(omitted, 'any-verb');
      continue;
    }
    const route = `${method}:${path}`;
    if (seen.has(route)) {
      count(omitted, 'duplicate-route');
      continue;
    }
    seen.add(route);
    const { template, names } = templateOf(entry, path);
    const { edge, several } = handlesOf(lookup, entry);
    planned.push({
      entry,
      verb,
      key: route,
      template,
      names,
      handles: edge,
      several,
      handler: edge === undefined ? undefined : lookup.node(edge.to),
    });
  }
  return planned.sort((a, b) => cmp(a.template, b.template) || (VERB_RANK.get(a.verb) ?? 0) - (VERB_RANK.get(b.verb) ?? 0));
};

/** What a route is written from: its body, its answer, its parameters and its failures' bodies. */
const rootsOf = (lookup: GraphLookup, plan: Planned): ShapeRoot[] => {
  const meta = plan.handles?.meta ?? {};
  const receive = [bodyOf(plan.handles), text(meta['params']), text(meta['query']), text(meta['headers'])];
  const parts = ['params', 'query', 'headers'].flatMap((part) => (fieldsOfRef(lookup, text(meta[part])) ?? []).map((field) => field.type));
  const sent = [
    plan.handles?.returns,
    text(meta[STATUS_UNKNOWN_META]),
    ...Object.values((meta[FAILURES_META] ?? {}) as Record<string, unknown>).filter((ref): ref is string => typeof ref === 'string'),
  ];
  return [
    ...[...receive, ...parts].flatMap((ref) => (ref === undefined ? [] : [{ ref, side: 'receiver' as const }])),
    ...sent.flatMap((ref) => (ref === undefined ? [] : [{ ref, side: 'sender' as const }])),
  ];
};

const content = (schema: JsonSchema): Record<string, unknown> => ({ [JSON_MEDIA]: { schema } });

/** The guards in front, as `x-flowatlas-guards` lists them: where each was put, and how. */
const guardsOf = (lookup: GraphLookup, entry: GraphNode): Array<Record<string, unknown>> => {
  const access = accessOf(entry);
  if (access !== undefined) {
    return access.guards.map((guard) => ({
      name: guard.name,
      layer: guard.layer,
      where: guard.where,
      via: guard.via,
      ...(guard.skippedBy === undefined ? {} : { skippedBy: guard.skippedBy }),
    }));
  }
  // A reading that drew the chain but wrote no answer: the chain is still what
  // stands in front, without where each piece was put.
  return lookup
    .edgesFrom(entry.id, ['guarded_by'])
    .sort((a, b) => (Number(a.meta?.['order'] ?? 0) - Number(b.meta?.['order'] ?? 0)) || cmp(a.to, b.to))
    .map((edge) => ({ name: lookup.node(edge.to)?.label ?? edge.to, layer: text(edge.meta?.['layer']) ?? 'guard' }));
};

/** An operation's id: the handler's name, made unique in its document. */
const operationIdOf = (plan: Planned, used: Set<string>): string => {
  const base = plan.handler?.label ?? `${plan.verb} ${plan.template}`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}_${n}`;
  used.add(id);
  return id;
};

const writeOne = (
  lookup: GraphLookup,
  service: string,
  application: string | undefined,
  entries: readonly GraphNode[],
  options: SpecOptions,
): WrittenSpec | undefined => {
  const omitted: Record<string, number> = {};
  const plans = planRoutes(lookup, entries, omitted);
  if (plans.length === 0) return undefined;
  const writer = shapeWriter(lookup, plans.flatMap((plan) => rootsOf(lookup, plan)), options);
  const usedIds = new Set<string>();
  const paths: Record<string, Record<string, unknown>> = {};
  const operations: SpecOperation[] = [];

  for (const plan of plans) {
    const meta = plan.handles?.meta ?? {};
    const levels: Confidence[] = [plan.handles?.confidence ?? 'static'];
    if (plan.several) levels.push('heuristic');

    const pathFields = fieldsOfRef(lookup, text(meta['params'])) ?? [];
    const parameters: Array<Record<string, unknown>> = plan.names.map(({ name, read }) => {
      const field = pathFields.find((each) => each.name === name);
      return {
        name,
        in: 'path',
        required: true,
        schema: field === undefined ? { type: 'string' } : writer.schemaOf(field.type, 'receiver'),
        ...(read ? {} : { 'x-flowatlas-unnamed': true }),
      };
    });
    for (const [part, place] of [
      ['query', 'query'],
      ['headers', 'header'],
    ] as const) {
      const fields = fieldsOfRef(lookup, text(meta[part])) ?? [];
      for (const field of [...fields].sort((a, b) => cmp(a.name, b.name))) {
        parameters.push({ name: field.name, in: place, required: !field.optional, schema: writer.schemaOf(field.type, 'receiver') });
      }
    }

    const body = bodyOf(plan.handles);
    const requestBody =
      body === undefined || NOTHING.has(body)
        ? undefined
        : {
            required: true,
            content: content(writer.schemaOf(body, 'receiver')),
            ...(claimed(plan.handles, 'body') ? { 'x-flowatlas-claimed': true } : {}),
          };
    if (requestBody?.['x-flowatlas-claimed'] === true) levels.push('heuristic');

    const responses: Record<string, unknown> = {};
    const returns = plan.handles?.returns;
    if (returns === undefined) {
      responses[SUCCESS] = { description: 'Success; what it answers was not read', [UNREAD_KEY]: 'answer-unread' };
    } else if (NOTHING.has(returns)) {
      responses[SUCCESS] = { description: 'Success, with no body' };
    } else {
      responses[SUCCESS] = {
        description: 'Success',
        content: content(writer.schemaOf(returns, 'sender')),
        ...(claimed(plan.handles, 'response') ? { 'x-flowatlas-claimed': true } : {}),
      };
      if (claimed(plan.handles, 'response')) levels.push('heuristic');
    }
    const computed = text(meta[STATUS_UNKNOWN_META]);
    const sent = Object.fromEntries(
      Object.entries((meta[FAILURES_META] ?? {}) as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    );
    for (const [status, answer] of failureAnswers(groupFailures(failuresOf(plan.entry)), sent)) {
      const unread = status === 'default';
      responses[status] = {
        description: answer.exceptions.length === 0 ? `Failure, status ${status}` : `${answer.exceptions.join(', ')}${unread ? ' (status not read)' : ''}`,
        ...(answer.ref === undefined ? {} : { content: content(writer.schemaOf(answer.ref, 'sender')) }),
        ...(answer.assumed && answer.exceptions.length > 0 ? { 'x-flowatlas-assumed': true } : {}),
        ...(answer.sources.size === 0 ? {} : { 'x-flowatlas-sources': [...answer.sources] }),
        ...(unread ? { [UNREAD_KEY]: 'status-unread' } : {}),
      };
    }
    if (computed !== undefined && !Object.hasOwn(responses, 'default')) {
      responses['default'] = {
        description: 'Answered with a status the code works out',
        content: content(writer.schemaOf(computed, 'sender')),
        [UNREAD_KEY]: 'status-unread',
      };
    }

    const guards = guardsOf(lookup, plan.entry);
    const opened = publicOf(plan.entry, options);
    const callers = routeCallers(lookup, plan.entry.id);
    const confidence = weakest(levels);
    const summary = text(plan.entry.meta?.['summary']);
    const source = sourceOf(plan.handles?.file === undefined ? plan.entry : { file: plan.handles.file, line: plan.handles.line ?? plan.entry.line });
    const operation: Record<string, unknown> = {
      operationId: operationIdOf(plan, usedIds),
      ...(summary === undefined ? {} : { summary }),
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(requestBody === undefined ? {} : { requestBody }),
      responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => responseOrder(a, b))),
      ...(guards.length === 0 ? {} : { 'x-flowatlas-guards': guards }),
      ...(opened === undefined ? {} : { 'x-flowatlas-public': true, 'x-flowatlas-public-by': opened }),
      ...(source === undefined ? {} : { 'x-flowatlas-source': source }),
      'x-flowatlas-confidence': confidence,
      'x-flowatlas-callers': callersBy(callers),
    };
    const item = paths[plan.template] ?? {};
    item[plan.verb] = operation;
    paths[plan.template] = item;
    operations.push({
      key: `${plan.verb.toUpperCase()} ${plan.template}`,
      kind: 'http',
      node: plan.entry.id,
      pointer: ['paths', plan.template, plan.verb],
      route: plan.key,
      callers,
      ...(opened === undefined ? {} : { public: opened }),
      confidence,
      ...(plan.entry.file === undefined ? {} : { file: plan.entry.file }),
      ...(plan.entry.line === undefined ? {} : { line: plan.entry.line }),
    });
  }

  const name = application === undefined ? service : `${service}@${application}`;
  const { document: written, components } = writer.finish({ paths: sortedRecord(Object.entries(paths)) });
  const document: Record<string, unknown> = {
    openapi: OPENAPI_VERSION,
    info: {
      title: name,
      version: SPEC_VERSION_SAID,
      description: `The routes of ${name}, as flowatlas read them from the code. Nothing here was run.`,
    },
    paths: written.paths,
    ...(Object.keys(components).length === 0 ? {} : { components: { schemas: components } }),
    ...(Object.keys(omitted).length === 0 ? {} : { 'x-flowatlas-omitted': sortedRecord(Object.entries(omitted)) }),
  };
  return {
    kind: 'openapi',
    service,
    ...(application === undefined ? {} : { application }),
    name,
    document,
    operations,
    omitted: sortedRecord(Object.entries(omitted)),
    unread: sortedRecord(Object.entries(unreadCounts(document))),
  };
};

/**
 * One OpenAPI document per application of a service: an application is an
 * address space of its own, so two of them in one document would put two
 * routes on one path. Empty when the service answers no routes.
 */
export const writeOpenapiDocuments = (lookup: GraphLookup, service: string, options: SpecOptions = {}): WrittenSpec[] => {
  const byApplication = new Map<string, GraphNode[]>();
  for (const entry of serviceNodes(lookup, 'entry', service)) {
    if (entry.kind !== 'http') continue;
    const application = applicationOf(entry.id) ?? '';
    byApplication.set(application, [...(byApplication.get(application) ?? []), entry]);
  }
  return [...byApplication.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .flatMap(([application, entries]) => {
      const written = writeOne(lookup, service, application === '' ? undefined : application, entries, options);
      return written === undefined ? [] : [written];
    });
};

/** The OpenAPI document of one service (its first application, or the one named). */
export const writeOpenapiDocument = (
  lookup: GraphLookup,
  service: string,
  options: SpecOptions & { application?: string } = {},
): WrittenSpec | undefined =>
  writeOpenapiDocuments(lookup, service, options).find((written) => options.application === undefined || written.application === options.application);

/** How many procedures a service has, which a route document leaves out (they are in the inventory). */
export const proceduresOf = (lookup: GraphLookup, service: string): GraphNode[] =>
  serviceNodes(lookup, 'entry', service).filter((entry) => entry.kind === 'rpc');
