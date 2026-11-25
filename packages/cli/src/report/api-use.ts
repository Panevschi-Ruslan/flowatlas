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
 *   forwarded) or what it reads is not known - a response field is judged
 *   by what each request's client reads of the answer (P391, P393), and a
 *   request no front-end reader followed is a warning: said, never guessed;
 * - the flows that prove it, way in -> client call -> route -> handler ->
 *   publish -> consumer, across repositories, for SARIF's codeFlows;
 * - a deploy order, and where on the head side it is placed, since a pull
 *   request is annotated only on lines it holds.
 */
import { HEADERS_META, isEntryId, MESSAGE_TYPES_META, type GraphNode, type SwitchedOver } from '@flowatlas/core';
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
import { answerReadingOf, consumerReading, FORWARD_EDGES, readsField, shapeFields, topField, type FieldSite, type Reading } from '@flowatlas/mcp';

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
const inner = (field: string | null, prefix: string): string => {
  if (field === null || field === prefix || field === `${prefix}[]`) return '';
  if (field.startsWith(`${prefix}.`)) return field.slice(prefix.length + 1);
  // A list's element (`response[].sku`): its fields, as the code reading each element names them (P393).
  if (field.startsWith(`${prefix}[].`)) return field.slice(prefix.length + 3);
  return field;
};

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
 * What the client code behind a request reads of its answer (P391: the
 * front-end readers write it on each browser request), on the side the
 * request is drawn on; undefined where no reader followed it (a server's
 * request, or one whose client is not read): that caller is then a warning,
 * said so, never an error or an info guessed.
 */
const responseReading = (graphs: UseGraphs, caller: string): (Reading & { files: Map<string, string>; db: GraphDb }) | undefined => {
  const found = either(graphs, caller);
  if (found === undefined) return undefined;
  const reading = answerReadingOf(found.db, caller);
  return reading.known ? { ...reading, db: found.db } : undefined;
};

/** A response field as a client's reads name it: a list's element is read at the list's path (`[].sku` is `sku`, `items[].sku` is `items.sku`). */
const answerField = (field: string): string => field.replace(/\[\]/g, '').replace(/^\./, '');

/** The read of a field whose value the code switches over (P402): the one naming the field itself first. */
const switchedRead = (reads: readonly FieldSite[], field: string): { row: FieldSite; over: SwitchedOver } | undefined => {
  const rows = reads.filter((row) => row.switched !== undefined && readsField(row.field, field));
  const row = rows.find((each) => each.field === field) ?? rows[0];
  return row?.switched === undefined ? undefined : { row, over: row.switched };
};

/**
 * What a switch over a field does with the values a widened type gains
 * (P402): a value a case names is handled; one no case names goes to the
 * `default` (a warning: whether that suits it is not read), or, with no
 * `default` or one that proves no value is left, is handled by nothing (an
 * error).
 */
const switchVerdict = (field: string, over: SwitchedOver, widened: readonly string[]): Pick<SpecUseReader, 'how' | 'said' | 'level'> => {
  const missing = widened.filter((value) => !over.cases.includes(value));
  const at = `switches over ${code(field)}, line ${over.line}`;
  if (missing.length === 0) return { how: 'reads', said: `${at}, with a case for ${widened.join(', ')}`, level: 'info' };
  if (over.has === 'none') return { how: 'reads', said: `${at}, with no default: ${missing.join(', ')} is handled by no case`, level: 'error' };
  if (over.has === 'never') return { how: 'reads', said: `${at}, exhaustively (its default proves no value is left): ${missing.join(', ')} is handled by no case`, level: 'error' };
  return { how: 'reads', said: `${at}, with a default: ${missing.join(', ')} goes to it; whether that suits ${missing.length === 1 ? 'it' : 'them'} is not read`, level: 'warning' };
};

/**
 * The keys of a request's query, the names of its headers, or the
 * parameters of its path, as the browser reader read them off the call
 * (P258, P388); undefined where that part of the request was not read: a
 * server's request, or one whose part is written as code.
 */
const partSent = (node: GraphNode, place: string): { keys: string[] } | { unknown: string } => {
  const meta = node.meta ?? {};
  if (node.type !== 'ui_api_call') return { unknown: `what it sends in its ${place} is not read` };
  if (place === 'query') {
    if (meta['queryUnread'] === true) return { unknown: 'its query is written as code, so which keys it sends is not read' };
    const written = Array.isArray(meta['queryKeys']) ? (meta['queryKeys'] as string[]) : [];
    const address = String(meta['url'] ?? meta['path'] ?? '');
    const inAddress = [...address.slice(address.indexOf('?') + 1 || address.length).matchAll(/(?:^|&)([^=&${}]+)=/g)].map((match) => match[1] as string);
    return { keys: [...new Set([...written, ...inAddress])].sort() };
  }
  if (place === 'header') {
    const names = [...(Array.isArray(meta['headerKeys']) ? (meta['headerKeys'] as string[]) : []), ...(Array.isArray(meta[HEADERS_META]) ? (meta[HEADERS_META] as string[]) : [])];
    const keys = [...new Set(names.map((name) => name.toLowerCase()))].sort();
    if (meta['headersUnread'] === true) return { unknown: `its headers may be set where they are not read${keys.length === 0 ? '' : ` (it sends ${keys.join(', ')})`}` };
    return { keys };
  }
  return { unknown: `what it sends in its ${place} is not read` };
};

/**
 * One caller's verdict on a change to a query key, a header or a path
 * parameter (P402), from what its request was read to send: a path parameter
 * is in every address that reaches the route; a query key or a header is
 * sent where the call writes it, here or in the settings every request of its
 * client carries.
 */
const parameterReader = (graphs: UseGraphs, change: SpecChange, caller: SpecChange['callers'][number], narrowed: boolean): SpecUseReader => {
  const found = either(graphs, caller.id);
  const at = { id: caller.id, service: caller.service, ...placeOf(found?.node) };
  const field = change.field ?? '';
  const dot = field.indexOf('.');
  const place = dot < 0 ? field : field.slice(0, dot);
  const name = dot < 0 ? '' : field.slice(dot + 1);
  const required = change.kind === 'request-property-added-required' || change.kind === 'request-property-became-required';
  if (place === 'path') {
    return required
      ? { ...at, how: 'sends', said: 'its address reaches the route, so it fills the path parameter', level: 'info' }
      : { ...at, how: 'unknown', said: `what it sends in ${code(field)} is not read`, level: 'warning' };
  }
  if (found === undefined) return { ...at, how: 'unread', said: 'not in either graph', level: 'warning' };
  const sent = partSent(found.node, place);
  if ('unknown' in sent) return { ...at, how: 'unknown', said: sent.unknown, level: 'warning' };
  const key = place === 'header' ? name.toLowerCase() : name;
  const sends = sent.keys.includes(key);
  const said = sent.keys.length === 0 ? `sends no ${place === 'header' ? 'header' : 'query key'}` : `sends ${place} ${sent.keys.join(', ')}`;
  if (required) return sends ? { ...at, how: 'sends', said: `sends ${code(field)}`, level: 'info' } : { ...at, how: 'omits', said: `${said}; no ${code(field)}`, level: 'error' };
  if (!sends) return { ...at, how: 'ignores', said: `does not send ${code(field)}`, level: 'info' };
  if (change.kind === 'request-property-removed') return { ...at, how: 'sends', said: `sends ${code(field)}; it lands nowhere, or is refused where unknown keys are`, level: 'warning' };
  if (change.kind === 'request-property-type-changed') {
    return narrowed
      ? { ...at, how: 'sends', said: `sends ${code(field)} as ${code(change.base ?? 'the old type')}`, level: 'error' }
      : { ...at, how: 'sends', said: `sends ${code(field)}`, level: 'info' };
  }
  return { ...at, how: 'sends', said: `sends ${code(field)}`, level: 'info' };
};

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
    if (widened === undefined) return { ...where, how: 'reads', said: `reads ${code(field)}, line ${read.line}`, level: 'error' };
    const switched = switchedRead(reading.reads, field);
    if (switched !== undefined) return { ...where, ...placeOf(found.db.node(switched.row.id)), line: switched.over.line, ...switchVerdict(field, switched.over, widened) };
    return { ...where, how: 'reads', said: `reads ${code(field)}, line ${read.line}; whether it handles ${widened.join(', ')} is not read`, level: 'warning' };
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

/**
 * What the callers of a route do with a change to its answer, from what each
 * request's client was read to read of it (P391): a read of the field is an
 * error placed on the reading code, a client that reads other fields only is
 * info, one that hands the answer where it was not followed, or a request no
 * reader followed, a warning.
 */
const responseReader = (graphs: UseGraphs, change: SpecChange, caller: SpecChange['callers'][number], widened: string[] | undefined): SpecUseReader => {
  const at = { id: caller.id, service: caller.service, ...placeOf(either(graphs, caller.id)?.node) };
  const field = answerField(inner(change.field, 'response'));
  const reading = responseReading(graphs, caller.id);
  if (reading === undefined) {
    return { ...at, how: 'unknown', said: `which fields of the answer its client reads was not read, so whether it reads ${code(field || 'the answer')} is not known`, level: 'warning' };
  }
  // A change to the whole answer (its type) is read by any read of it.
  const read = reading.reads.find((row) => field === '' || readsField(row.field, field));
  if (read !== undefined) {
    const where = { ...at, ...placeOf(reading.db.node(read.id)), line: read.line };
    const file = reading.files.get(`${read.field}|${read.id}|${read.line}`);
    const place = { ...where, ...(file === undefined ? {} : { file }) };
    const label = reading.db.node(read.id)?.label;
    const said = `reads ${code(read.field)}${label === undefined ? '' : ` in ${label}`}, line ${read.line}${file === undefined ? '' : ` of ${file}`}`;
    if (widened === undefined) return { ...place, how: 'reads', said, level: 'error' };
    const switched = switchedRead(reading.reads, field);
    if (switched !== undefined) {
      const switchFile = reading.files.get(`${switched.row.field}|${switched.row.id}|${switched.row.line}`);
      return {
        ...where,
        ...placeOf(reading.db.node(switched.row.id)),
        ...(switchFile === undefined ? {} : { file: switchFile }),
        line: switched.over.line,
        ...switchVerdict(field, switched.over, widened),
      };
    }
    return { ...place, how: 'reads', said: `${said}; whether it handles ${widened.join(', ')} is not read`, level: 'warning' };
  }
  const opaque = reading.unread[0];
  if (opaque !== undefined) {
    return { ...at, line: opaque.line, how: 'opaque', said: `hands the answer on whole (${opaque.why}, line ${opaque.line}), so whether it reads ${code(field)} is not known`, level: 'warning' };
  }
  return { ...at, how: 'ignores', said: `does not read ${code(field)}`, level: 'info' };
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
        return parameterReader(graphs, change, caller, literal?.how !== 'widened');
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
            : `no ${noun} ${partOf(change) === 'body' || partOf(change) === 'parameter' ? 'sends' : 'reads'} ${what}, among ${among}`;
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
    case 'response-property-type-changed':
      // An answer that gains values: the callers learn them first (P402).
      return literal?.how === 'widened'
        ? { first: 'callers', said: `callers first: handle ${literal.values.join(', ')}, then ${service}` }
        : { first: 'callers', said: `callers first: stop relying on ${what || 'it'}, then ${service}` };
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
