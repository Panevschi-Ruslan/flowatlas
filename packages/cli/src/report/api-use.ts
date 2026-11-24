/**
 * What an API or message change does to the code that uses it (P390).
 *
 * A document differ rates a change by its kind: a response field removed is
 * breaking whoever calls the route, a required request field added is
 * breaking whatever the callers send. The graph knows more: which request
 * sends which fields (the shape each request was read to send), which
 * consumer reads which fields of a message (P368), and the flow from a way in
 * in one repository to the consumer in another. So each change gets
 *
 * - a direction (oasdiff's model): narrowing what a route accepts, or
 *   widening what it answers or a message carries, breaks the other end;
 *   the reverse cannot; what neither side settles is unconfirmed;
 * - a level from use: `error` when a joined consumer reads the removed or
 *   retyped field, sends a field now invalid or omits one now required (or
 *   calls a route that is gone); `info` when none reads it, among the ones
 *   counted; `warning` where the value reaches one opaquely (spread,
 *   forwarded) or what it reads is not known - which is every response
 *   field today, since which fields a client reads of an answer is not read
 *   yet: said, never guessed;
 * - the flows that prove it, way in -> client call -> route -> handler ->
 *   publish -> consumer, across repositories, for SARIF's codeFlows;
 * - a deploy order, and where on the head side it is placed, since a pull
 *   request is annotated only on lines it holds.
 */
import { isEntryId, MESSAGE_TYPES_META, type GraphNode } from '@flowatlas/core';
import {
  SPEC_CHANGE_KINDS,
  type GraphDb,
  type SpecAnchor,
  type SpecChange,
  type SpecChangeDirection,
  type SpecChangeKind,
  type SpecChangeLevel,
  type SpecChangeUse,
  type SpecCoverage,
  type SpecDeployOrder,
  type SpecDiffReport,
  type SpecFlowStep,
  type SpecFlowStepKind,
  type SpecUseContext,
  type SpecUseReader,
} from '@flowatlas/linker';
import { consumerReading, FORWARD_EDGES, readsField, shapeFields, topField, type Reading } from '@flowatlas/mcp';

/** Both sides' graphs, open while the documents are compared. */
export interface UseGraphs {
  base: GraphDb;
  head: GraphDb;
}

/** The most flows a change carries: the loudest consumers first. */
const MOST_FLOWS = 3;

/** How far a walk back to a way in goes before it settles for the nearest one it met. */
const WALK_NODES = 400;

const LEVEL_RANK: Readonly<Record<SpecChangeLevel, number>> = { error: 0, warning: 1, info: 2 };
const louder = (a: SpecChangeLevel, b: SpecChangeLevel): SpecChangeLevel => (LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b);
const code = (text: string): string => `\`${text}\``;
const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** Which way each kind moves the contract, and why, before literal values are compared. */
const DIRECTION: Readonly<Record<SpecChangeKind, readonly [SpecChangeDirection, string]>> = {
  'endpoint-removed': ['breaking', 'the route is gone: every request to it fails'],
  'method-removed': ['breaking', 'the path no longer answers this verb'],
  'path-param-added': ['breaking', 'a request written for the old path no longer matches'],
  'request-property-became-required': ['breaking', 'narrows the request: a caller must now send it'],
  'request-property-added-required': ['breaking', 'narrows the request: a caller must now send it'],
  'request-property-type-changed': ['breaking', 'narrows the request: a caller sends the old type'],
  'request-property-removed': ['unconfirmed', 'the route stops reading it: dropped, or refused where unknown fields are'],
  'response-property-removed': ['breaking', 'the answer no longer holds it'],
  'response-property-type-changed': ['breaking', 'the answer holds another type'],
  'response-property-became-optional': ['breaking', 'widens the response: it may now be absent'],
  'response-status-removed': ['breaking', 'a success status callers wait for is gone'],
  'response-status-added': ['breaking', 'widens the response: a status callers may not handle'],
  'channel-removed': ['breaking', 'consumers get nothing from this service any more'],
  'message-property-removed': ['breaking', 'the message no longer carries it'],
  'message-property-type-changed': ['breaking', 'the message carries another type'],
  'message-property-became-optional': ['breaking', 'widens the message: it may now be absent'],
  'security-added': ['breaking', 'narrows who may call it'],
  'channel-consumer-removed': ['unconfirmed', 'what is published there is no longer handled here'],
  'endpoint-added': ['compatible', 'added: nothing that worked before can rely on it'],
  'optional-property-added': ['compatible', 'a field nothing has to send or read'],
  'description-changed': ['compatible', 'only the words changed'],
};

/** A side's literal values, where it is a choice of literals and nothing else: `'a' | 'b'`. */
export const literalsOf = (said: string | null): Set<string> | undefined => {
  if (said === null) return undefined;
  const parts = said.split(' | ').map((part) => part.trim());
  if (parts.length === 0 || !parts.every((part) => /^'.*'$/.test(part) || /^-?\d+(\.\d+)?$/.test(part) || part === 'true' || part === 'false')) return undefined;
  return new Set(parts);
};

/** Whether a type change only added literal values (`widened`), only took some away (`narrowed`), or neither. */
export const literalChange = (base: string | null, head: string | null): { how: 'widened' | 'narrowed'; values: string[] } | undefined => {
  const was = literalsOf(base);
  const now = literalsOf(head);
  if (was === undefined || now === undefined) return undefined;
  const added = [...now].filter((value) => !was.has(value));
  const removed = [...was].filter((value) => !now.has(value));
  if (added.length > 0 && removed.length === 0) return { how: 'widened', values: added };
  if (removed.length > 0 && added.length === 0) return { how: 'narrowed', values: removed };
  return undefined;
};

/** Which end of the operation a change is about, read off its kind and field. */
type Part = 'operation' | 'body' | 'parameter' | 'response' | 'status' | 'guards' | 'message' | 'channel';

const partOf = (change: SpecChange): Part => {
  if (change.kind.startsWith('message-')) return 'message';
  if (change.kind === 'channel-removed' || change.kind === 'channel-consumer-removed') return 'channel';
  if (change.field === null) return 'operation';
  if (change.field === 'guards') return 'guards';
  if (change.field.startsWith('status ')) return 'status';
  if (change.field === 'body' || change.field.startsWith('body.')) return 'body';
  if (change.field.startsWith('response')) return 'response';
  if (change.format === 'asyncapi') return 'message';
  return 'parameter';
};

/** The field under its part's prefix: `body.currency` is `currency`, `payload.label` is `label`. */
const inner = (field: string | null, prefix: string): string => (field === null ? '' : field === prefix ? '' : field.startsWith(`${prefix}.`) ? field.slice(prefix.length + 1) : field);

/** The node of an id on the side that ships, else the side it was joined on. */
const either = (graphs: UseGraphs, id: string): { node: GraphNode; db: GraphDb } | undefined => {
  const head = graphs.head.node(id);
  if (head !== undefined) return { node: head, db: graphs.head };
  const base = graphs.base.node(id);
  return base === undefined ? undefined : { node: base, db: graphs.base };
};

const placeOf = (node: GraphNode | undefined): Pick<SpecUseReader, 'file' | 'line'> =>
  node === undefined ? {} : { ...(node.file === undefined ? {} : { file: node.file }), ...(node.line === undefined ? {} : { line: node.line }) };

/** The fields a request was read to send as its body, or why that is not known. */
const sentBy = (graphs: UseGraphs, caller: SpecChange['callers'][number], target: string): { fields: string[] } | { unknown: string } => {
  const edge = graphs.base.edgesFrom(caller.id, [caller.via]).find((each) => each.to === target) ?? graphs.base.edgesFrom(caller.id, [caller.via])[0];
  const param = edge?.params?.[0];
  if (param === undefined) return { unknown: 'no body was read for this request' };
  const fields = shapeFields(graphs.base, param);
  return fields === undefined ? { unknown: `sends ${code(param)}, a shape not read` } : { fields };
};

/** The one type of message a publish sends, where it says one: what a consumer's reads are narrowed to. */
const typeSent = (graphs: UseGraphs, producer: string): string | undefined => {
  const types = (either(graphs, producer)?.node.meta?.[MESSAGE_TYPES_META] as unknown[] | undefined) ?? [];
  return types.length === 1 && typeof types[0] === 'string' ? types[0] : undefined;
};

/**
 * What the client code reads of an answer, which is not read yet (P391 reads
 * it): every response change is then a warning where a caller exists, saying
 * so, and never an error or an info guessed.
 */
const responseReading = (_graphs: UseGraphs, _caller: string): Reading | undefined => undefined;

/** One consumer's verdict on a message change, from what it reads (P368). */
const messageReader = (
  graphs: UseGraphs,
  consumer: SpecChange['callers'][number],
  field: string,
  type: string | undefined,
  widened: string[] | undefined,
): SpecUseReader => {
  const found = either(graphs, consumer.id);
  const at = { id: consumer.id, service: consumer.service, ...placeOf(found?.node ?? undefined) };
  if (found === undefined) return { ...at, how: 'unread', said: 'not in either graph', level: 'warning' };
  const reading = consumerReading(found.db, found.node, type);
  if (!reading.known) return { ...at, how: 'unread', said: 'was not read for the fields it reads', level: 'warning' };
  const read = reading.reads.find((row) => readsField(row.field, field));
  if (read !== undefined) {
    const where = { ...at, ...placeOf(found.db.node(read.id)), line: read.line };
    return widened === undefined
      ? { ...where, how: 'reads', said: `reads ${code(field)}, line ${read.line}`, level: 'error' }
      : { ...where, how: 'reads', said: `reads ${code(field)}, line ${read.line}; whether it handles ${widened.join(', ')} is not read`, level: 'warning' };
  }
  const opaque = reading.unread[0];
  if (opaque !== undefined) {
    return { ...at, line: opaque.line, how: 'opaque', said: `takes the message whole (${opaque.why}, line ${opaque.line}), so whether it reads ${code(field)} is not known`, level: 'warning' };
  }
  return { ...at, how: 'ignores', said: `does not read ${code(field)}`, level: 'info' };
};

/** One caller's verdict on a request change, from the fields it was read to send. */
const requestReader = (graphs: UseGraphs, change: SpecChange, caller: SpecChange['callers'][number], target: string, narrowed: boolean): SpecUseReader => {
  const at = { id: caller.id, service: caller.service, ...placeOf(either(graphs, caller.id)?.node) };
  const field = inner(change.field, 'body');
  const top = field === '' ? '' : topField(field);
  const sent = sentBy(graphs, caller, target);
  const required = change.kind === 'request-property-added-required' || change.kind === 'request-property-became-required';
  if ('unknown' in sent) return { ...at, how: 'unknown', said: sent.unknown, level: 'warning' };
  const sends = field === '' ? sent.fields.length > 0 : sent.fields.includes(top);
  const said = sent.fields.length === 0 ? 'sends no field' : `sends ${sent.fields.join(', ')}`;
  if (required) {
    if (!sends) return { ...at, how: 'omits', said: `${said}; no ${code(field || 'body')}`, level: 'error' };
    if (top !== field) return { ...at, how: 'unknown', said: `sends ${code(top)}; whether it holds ${code(field)} is not read`, level: 'warning' };
    return { ...at, how: 'sends', said: `sends ${code(field || 'a body')}`, level: 'info' };
  }
  if (!sends) return { ...at, how: 'ignores', said: `does not send ${code(field || 'a body')}`, level: 'info' };
  if (change.kind === 'request-property-removed') {
    return { ...at, how: 'sends', said: `sends ${code(field || 'a body')}; it lands nowhere, or is refused where unknown fields are`, level: 'warning' };
  }
  return narrowed
    ? { ...at, how: 'sends', said: `sends ${code(field)} as ${code(change.base ?? 'the old type')}`, level: 'error' }
    : { ...at, how: 'sends', said: `sends ${code(field)}`, level: 'info' };
};

/** What the callers of a route do with a change to its answer: unknown until a client's reads of an answer are read. */
const responseReader = (graphs: UseGraphs, change: SpecChange, caller: SpecChange['callers'][number], widened: string[] | undefined): SpecUseReader => {
  const at = { id: caller.id, service: caller.service, ...placeOf(either(graphs, caller.id)?.node) };
  const field = inner(change.field, 'response');
  const reading = responseReading(graphs, caller.id);
  if (reading === undefined) {
    return { ...at, how: 'unknown', said: `which fields of the answer it reads is not read yet, so whether it reads ${code(field || 'the answer')} is not known`, level: 'warning' };
  }
  const read = reading.reads.find((row) => readsField(row.field, field));
  if (read !== undefined) return { ...at, line: read.line, how: 'reads', said: `reads ${code(field)}, line ${read.line}`, level: widened === undefined ? 'error' : 'warning' };
  return reading.unread.length > 0
    ? { ...at, how: 'opaque', said: `hands the answer on whole (${reading.unread[0]?.why ?? 'not followed'})`, level: 'warning' }
    : { ...at, how: 'ignores', said: `does not read ${code(field)}`, level: 'info' };
};

/** Every consumer of a change and what it does with it, the loudest first. */
const readersOf = (graphs: UseGraphs, change: SpecChange, at: SpecUseContext, direction: SpecChangeDirection, literal: ReturnType<typeof literalChange>): SpecUseReader[] => {
  const part = partOf(change);
  const widened = literal?.how === 'widened' ? literal.values : undefined;
  const rows = change.callers.map((caller): SpecUseReader => {
    const at0 = { id: caller.id, service: caller.service, ...placeOf(either(graphs, caller.id)?.node) };
    if (direction === 'compatible') return { ...at0, how: 'joined', said: 'nothing it relied on changed', level: 'info' };
    switch (part) {
      case 'message':
        return messageReader(graphs, caller, inner(change.field, 'payload'), typeSent(graphs, at.operation.node), widened);
      case 'body':
        return requestReader(graphs, change, caller, at.operation.node, literal?.how !== 'widened');
      case 'response':
        return responseReader(graphs, change, caller, widened);
      case 'status':
        return { ...at0, how: 'unknown', said: `whether it ${change.kind === 'response-status-added' ? 'handles' : 'waits for'} ${change.field?.slice('status '.length) ?? 'the status'} is not read`, level: 'warning' };
      case 'guards':
        return { ...at0, how: 'unknown', said: `whether it has what ${change.head ?? 'the guard'} asks for is not read`, level: 'warning' };
      case 'parameter':
        return { ...at0, how: 'unknown', said: `what it sends in ${code(change.field ?? 'the request')} is not read`, level: 'warning' };
      case 'channel':
        return change.kind === 'channel-removed'
          ? { ...at0, how: 'joined', said: 'takes what is published there', level: 'error' }
          : { ...at0, how: 'joined', said: 'still publishes there', level: 'warning' };
      default:
        return { ...at0, how: 'joined', said: 'requests it', level: 'error' };
    }
  });
  return rows.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

const nounOf = (at: SpecUseContext): string =>
  at.operation.kind === 'send' ? 'consumer' : at.operation.kind === 'receive' ? 'publisher' : 'caller';

/** The one line a verdict says. */
const verdictOf = (change: SpecChange, at: SpecUseContext, level: SpecChangeLevel, readers: readonly SpecUseReader[], publicNote: boolean, repositories: number): string => {
  const noun = nounOf(at);
  const among = change.callers.length;
  const what = change.field === null ? 'it' : code(inner(inner(inner(change.field, 'body'), 'payload'), 'response') || change.field);
  if (level === 'info' || readers.every((reader) => reader.level === 'info')) {
    // An addition is joined on the head side only: the base side's consumers are none, not proof nobody uses it.
    if (DIRECTION[change.kind][0] === 'compatible' && among === 0) return `no ${noun} on the base side`;
    const base =
      among === 0
        ? `nothing in the ${plural(repositories, 'repository', 'repositories')} read ${at.operation.kind === 'send' ? 'consumes' : 'calls'} it`
        : readers.every((reader) => reader.how === 'sends')
          ? `every ${noun} sends ${what}, among ${among}`
          : readers.every((reader) => reader.how === 'joined')
            ? `nothing a ${noun} relied on changed, among ${among}`
            : `no ${noun} ${partOf(change) === 'body' ? 'sends' : 'reads'} ${what}, among ${among}`;
    return publicNote ? `${base}; it is public, so callers outside the project are not read` : base;
  }
  const loudest = readers.filter((reader) => reader.level === level);
  const first = loudest[0] as SpecUseReader;
  const others = loudest.filter((reader) => reader.said !== first.said);
  const more = others.length > 0 ? `; ${plural(others.length, 'other')}: ${(others[0] as SpecUseReader).said}` : '';
  return `${loudest.length} of ${plural(among, noun)}: ${first.said}${more}`;
};

/** The order to ship a change in so no end meets it before it can, where anyone is on the other end. */
const deployOrderOf = (change: SpecChange, at: SpecUseContext, direction: SpecChangeDirection, literal: ReturnType<typeof literalChange>): SpecDeployOrder | undefined => {
  if (change.callers.length === 0 || change.kind === 'description-changed') return undefined;
  const service = change.service;
  const what = change.field === null ? '' : code(inner(inner(inner(change.field, 'body'), 'payload'), 'response'));
  if (at.operation.kind === 'send') {
    if (direction === 'compatible') return { first: 'producers', said: `${service} first: a consumer can read ${what || 'it'} only once it is sent` };
    if (change.kind === 'channel-removed') return { first: 'consumers', said: `consumers first: stop depending on it, then ${service}` };
    if (literal?.how === 'widened') return { first: 'consumers', said: `consumers first: handle ${literal.values.join(', ')}, then ${service}` };
    return { first: 'consumers', said: `consumers first: stop reading ${what || 'it'} (or cope without it), then ${service}` };
  }
  if (at.operation.kind === 'receive') return { first: 'producers', said: `publishers first: stop publishing what ${service} will no longer handle, then ${service}` };
  switch (change.kind) {
    case 'request-property-added-required':
    case 'request-property-became-required':
      return { first: 'callers', said: `callers first: send ${what}, then ${service}` };
    case 'request-property-type-changed':
      return literal?.how === 'widened'
        ? { first: 'server', said: `${service} first: callers may send the new values only once it accepts them` }
        : { first: 'server', said: `${service} first, accepting both types, then the callers, then drop the old type` };
    case 'request-property-removed':
      return { first: 'server', said: `${service} first; the callers can stop sending ${what} after` };
    case 'endpoint-added':
    case 'optional-property-added':
      return { first: 'server', said: `${service} first: callers can use it only once it is there` };
    case 'security-added':
      return { first: 'callers', said: `callers first: give each what the guard asks for, then ${service}` };
    case 'response-status-added':
      return { first: 'callers', said: `callers first: handle the new status, then ${service}` };
    case 'endpoint-removed':
    case 'method-removed':
    case 'path-param-added':
      return { first: 'callers', said: `callers first: move them off it, then ${service}` };
    default:
      return { first: 'callers', said: `callers first: stop relying on ${what || 'it'}, then ${service}` };
  }
};

/**
 * The nodes of each file on the head side, by service and file, built once
 * per comparison: where a removal is anchored.
 */
const headFiles = (head: GraphDb): Map<string, GraphNode[]> => {
  const byFile = new Map<string, GraphNode[]>();
  for (const node of head.allNodes()) {
    if (node.file === undefined || node.line === undefined || node.line <= 0) continue;
    const key = `${node.repo}|${node.file}`;
    byFile.set(key, [...(byFile.get(key) ?? []), node]);
  }
  return byFile;
};

/** Where a change on the base side is placed on the head side: its own line, the nearest that survives, or the summary. */
const anchorOf = (graphs: UseGraphs, files: () => Map<string, GraphNode[]>, change: SpecChange, at: SpecUseContext): SpecAnchor | undefined => {
  if (at.side === 'head' || change.place === null) return undefined;
  const from = { file: change.place.file, ...(change.place.line === undefined ? {} : { line: change.place.line }) };
  const same = graphs.head.node(at.head?.node ?? at.operation.node);
  if (same?.file !== undefined && same.line !== undefined) return { how: 'same', file: same.file, line: same.line };
  const line = change.place.line ?? 0;
  const near = (files().get(`${change.service}|${change.place.file}`) ?? [])
    .map((node) => ({ node, distance: Math.abs((node.line ?? 0) - line) }))
    .sort((a, b) => a.distance - b.distance || (a.node.line ?? 0) - (b.node.line ?? 0) || (a.node.id < b.node.id ? -1 : 1))[0];
  if (near !== undefined) return { how: 'nearest', file: change.place.file, line: near.node.line as number, from };
  return { how: 'summary', from };
};

/** What a node is as a step of a flow. */
const stepKindOf = (node: GraphNode, index: number, previous: GraphNode | undefined): SpecFlowStepKind => {
  if (isEntryId(node.id)) return index === 0 ? 'way in' : 'route';
  if (node.type === 'http_out') return 'request';
  if (node.type === 'producer') return 'publish';
  if (node.type === 'channel') return 'channel';
  if (node.type === 'consumer') return 'consumer';
  if (previous !== undefined && (isEntryId(previous.id) || previous.type === 'consumer')) return 'handler';
  return 'code';
};

/**
 * The way in a node is reached from, and the path down to it: walked back
 * over the edges a flow follows, across repositories, to a way in nothing
 * calls (the nearest such one), bounded. A node nothing reaches is its own
 * start.
 */
export const pathFromWayIn = (db: GraphDb, start: string): string[] => {
  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  let found: string | undefined;
  let nearestEntry: string | undefined;
  while (queue.length > 0 && parent.size < WALK_NODES) {
    const id = queue.shift() as string;
    const into = db.edgesTo(id, FORWARD_EDGES).map((edge) => edge.from).filter((from, index, all) => all.indexOf(from) === index).sort();
    if (isEntryId(id) && id !== start && nearestEntry === undefined) nearestEntry = id;
    if (into.length === 0 && isEntryId(id)) {
      found = id;
      break;
    }
    for (const from of into) {
      if (parent.has(from)) continue;
      parent.set(from, id);
      queue.push(from);
    }
  }
  const top = found ?? nearestEntry ?? start;
  const path: string[] = [];
  for (let at: string | null | undefined = top; at !== null && at !== undefined; at = parent.get(at)) path.push(at);
  return path;
};

/** A path of ids as the steps of a flow, each placed where the side that ships has it. */
const stepsOf = (graphs: UseGraphs, ids: readonly string[]): SpecFlowStep[] => {
  const steps: SpecFlowStep[] = [];
  let previous: GraphNode | undefined;
  ids.forEach((id, index) => {
    const node = either(graphs, id)?.node;
    if (node === undefined) return;
    steps.push({ id, step: stepKindOf(node, index, previous), label: node.label, service: node.repo, ...placeOf(node) });
    previous = node;
  });
  return steps;
};

const handlerOf = (db: GraphDb, id: string): string | undefined => db.edgesFrom(id, ['handles'])[0]?.to;

/** The flow from a way in to one consumer of a change, across repositories. */
const flowOf = (graphs: UseGraphs, at: SpecUseContext, reader: SpecUseReader): SpecFlowStep[] => {
  const operation = at.operation;
  const { base } = graphs;
  if (operation.kind === 'http') {
    const handler = handlerOf(base, operation.node);
    return stepsOf(graphs, [...pathFromWayIn(base, reader.id), operation.node, ...(handler === undefined ? [] : [handler])]);
  }
  if (operation.kind === 'send') {
    const handler = handlerOf(base, reader.id);
    return stepsOf(graphs, [
      ...pathFromWayIn(base, operation.node),
      ...(operation.channel === undefined ? [] : [operation.channel]),
      reader.id,
      ...(handler === undefined ? [] : [handler]),
    ]);
  }
  return stepsOf(graphs, [...pathFromWayIn(base, reader.id), ...(operation.channel === undefined ? [] : [operation.channel]), operation.node]);
};

/**
 * The `useOf` a comparison of two sides' documents takes: each change's
 * direction, its level from use, the consumers behind it and the flows to
 * them, its deploy order and where it is placed on the head side.
 */
export const usageOf = (graphs: UseGraphs, repositories: number): ((change: SpecChange, at: SpecUseContext) => SpecChangeUse) => {
  let files: Map<string, GraphNode[]> | undefined;
  const filesOnce = (): Map<string, GraphNode[]> => (files ??= headFiles(graphs.head));
  return (change, at) => {
    const literal = change.kind.endsWith('-type-changed') ? literalChange(change.base, change.head) : undefined;
    const [catalogued, why] = DIRECTION[change.kind];
    const request = change.kind.startsWith('request-');
    // A request accepting more values breaks no caller; an answer or a message holding fewer breaks no reader.
    const direction: SpecChangeDirection =
      literal === undefined ? catalogued : (literal.how === 'widened') === request ? 'compatible' : 'breaking';
    const reason =
      literal === undefined
        ? why
        : literal.how === 'widened'
          ? request
            ? `widens the request: ${literal.values.join(', ')} accepted as well`
            : `gains ${literal.values.join(', ')}: a reader that handles every value meets one it does not know`
          : request
            ? `narrows the request: ${literal.values.join(', ')} refused`
            : `narrows what it carries: ${literal.values.join(', ')} no longer sent`;
    const readers = readersOf(graphs, change, at, direction, literal);
    const publicNote = at.operation.public !== undefined && direction !== 'compatible';
    let level: SpecChangeLevel =
      direction === 'compatible' || SPEC_CHANGE_KINDS[change.kind].level === 'info'
        ? 'info'
        : readers.reduce<SpecChangeLevel>((loudest, reader) => louder(loudest, reader.level), 'info');
    if (level === 'info' && publicNote) level = 'warning';
    const flows = readers
      .filter((reader) => reader.level !== 'info')
      .slice(0, MOST_FLOWS)
      .map((reader) => flowOf(graphs, at, reader))
      .filter((flow) => flow.length > 1);
    // An order matters only where some consumer meets the change.
    const deployOrder = level === 'info' ? undefined : deployOrderOf(change, at, direction, literal);
    const anchor = anchorOf(graphs, filesOnce, change, at);
    return {
      direction,
      why: reason,
      level,
      verdict: verdictOf(change, at, level, readers, publicNote, repositories),
      among: change.callers.length,
      readers,
      flows,
      ...(deployOrder === undefined ? {} : { deployOrder }),
      ...(anchor === undefined ? {} : { anchor }),
    };
  };
};

/** What the verdicts could see: the consumers they counted, in the repositories read. */
export const coverageOf = (report: Pick<SpecDiffReport, 'changes'>, repositories: number): SpecCoverage => {
  const consumers = new Set(report.changes.flatMap((change) => change.callers.map((caller) => caller.id))).size;
  return {
    consumers,
    repositories,
    said: `${plural(consumers, 'consumer')} in ${plural(repositories, 'repository', 'repositories')}; consumers outside them unknown`,
  };
};
