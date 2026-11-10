/**
 * Every place two services have to agree, and who says what at each of them.
 *
 * The graph draws a boundary three ways — a call to another service's route, a
 * request from a browser, a message on a channel — and each of those has two
 * halves that fail differently. The roles are the flow of the data and not the
 * direction of the arrow: on a response the handler is the sender, though the
 * edge points the other way. Getting that backwards would report every answer
 * as a missing request.
 */
import {
  CLAIMED_META,
  envelopePath,
  formatTypeRef,
  parseTypeRef,
  REQUEST_READ_META,
  STATUS_UNKNOWN_META,
  STARTS_META,
  type Envelope,
  type GraphEdge,
  type GraphNode,
  type TypeRefAst,
} from '@flowatlas/core';
import type { MissingRule } from './compare.js';
import { envelopeOf, readThrough, wrapped, type Blocked } from './envelope.js';
import { edgeKeyOf } from './key.js';
import type { ContractParty, Direction, GraphLookup, UncheckedReason } from './types.js';

/** One direction of one boundary, with both ends already worked out. */
export interface Exchange {
  edge: { from: string; to: string; type: string };
  edgeKey: string;
  direction: Direction;
  sender: ContractParty;
  receiver: ContractParty;
  /** Symbols an annotation could excuse this exchange from. */
  symbols: string[];
  /** Set when there was never anything to compare. */
  blocked?: Blocked;
  /**
   * The receiver reads part of what it is handed and carries the rest on, so a
   * key it does not read is not a key nobody reads.
   */
  carriesOn?: boolean;
  /**
   * Keys the platform wrote beside the message on the way, which nobody at the
   * sending end put there and nobody is told about as sent.
   */
  wrapperKeys?: readonly string[];
  /** Clauses a finding adds, saying what the message passed through on the way (R172). */
  via?: string[];
  /**
   * The handler's end was read by its framework's description (P29): it reads
   * its request and answers through what it is handed, so a missing type is
   * one nothing there states rather than a signature that declares none.
   */
  described?: boolean;
  /**
   * What the handler answers with a status its code works out (P30): a shape
   * that could be its answer or a failure, so nothing is compared with it.
   */
  statusUnknown?: string;
  /**
   * The boundary is a request for a procedure (P247), so a missing type is
   * one a client of a tree states in its own way, and the hint says that way.
   */
  procedure?: boolean;
  /**
   * The sender writes nothing at all - a `GET` of a procedure's route with
   * no path parameter and no query (P256) - so its `{}` is an empty object
   * on the wire, and what the receiver requires is missing.
   */
  sendsNothing?: boolean;
  /**
   * Fields the sender writes as an object with no keys - a `detailed` input's
   * `headers` where the call sends none the procedure declares (P262) - so
   * what the receiver requires there is missing.
   */
  writtenEmptyAt?: readonly string[];
  /** Names whose absence on the sender's side is said with a rule of its own (P265). */
  missingRules?: readonly MissingRule[];
  /** Rules that took something out of the comparison before it began, with the path (P265). */
  rulesApplied?: readonly string[];
}

/** References that name no shape, so there is nothing to compare against. */
const EMPTY_REFS = new Set(['', 'void', 'any', 'unknown', 'object', 'never', 'undefined', 'null']);

/** True when the reference actually claims a shape. */
export const namesAShape = (ref: string | undefined): ref is string =>
  ref !== undefined && !EMPTY_REFS.has(ref.trim());

const repoOf = (lookup: GraphLookup, id: string | undefined): string =>
  (id === undefined ? undefined : lookup.node(id)?.repo) ?? 'unknown';

/**
 * The method a reader would open to see this call.
 *
 * A request leaves from a node standing for the call itself, which is a
 * location rather than something anybody wrote; the method that made it is what
 * carries the annotations and what a person wants to look at.
 */
const callerOf = (lookup: GraphLookup, callId: string): string =>
  lookup.edgesTo(callId, ['calls'])[0]?.from ?? callId;

/** The handler a route or a channel entry point leads to. */
const handlerOf = (edge: GraphEdge | undefined, fallback: string): string => edge?.to ?? fallback;

/** The type a handler declares for the body it is given, when it declares one. */
export const bodyTypeOf = (handles: GraphEdge | undefined): string | undefined => {
  const body = handles?.meta?.['body'];
  if (typeof body === 'string') return body;
  // Without an annotated body the only honest candidate is a lone parameter
  // that names a shape: a route whose parameters are all path segments has no
  // body, and guessing one would invent a contract nobody wrote (I3).
  const named = (handles?.params ?? []).filter(namesAShape);
  return named.length === 1 ? named[0] : undefined;
};

/** `handles` edges out of an entry point, in a fixed order. */
export const handlesOf = (lookup: GraphLookup, entryId: string): GraphEdge[] =>
  lookup.edgesFrom(entryId, ['handles']).sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

/**
 * The document an end was declared by, when nobody here could read its source.
 *
 * Read off the node rather than off the configuration, because by the time a
 * boundary is being judged the configuration is two packages away and the fact
 * is already on every node and edge the document produced. A service that was
 * read carries nothing here and the key is left off the party entirely, so the
 * absence of it means "read" rather than "not looked into".
 */
const declaredBy = (lookup: GraphLookup, id: string): string | undefined => {
  const said = lookup.node(id)?.meta?.['declaredBy'];
  return typeof said === 'string' ? said : undefined;
};

const party = (
  lookup: GraphLookup,
  service: string,
  typeId: string | undefined,
  symbol: string,
): ContractParty => {
  const document = declaredBy(lookup, symbol);
  return {
    service,
    typeId: namesAShape(typeId) ? typeId : null,
    symbol,
    ...(document === undefined ? {} : { declaredBy: document }),
  };
};

/**
 * The two ends of an answer, whichever way the question was asked.
 *
 * A route and a request over a channel are answered the same way: the handler
 * declares what it returns, and the edge that asked carries what the asker
 * expects back as its `returns`. Read in one place so that the answer to a
 * `client.send` is compared exactly as the answer to an `http.get` is, rather
 * than by a second reading that could drift from the first (R151).
 */
const answer = (
  lookup: GraphLookup,
  handler: { service: string; handles: GraphEdge | undefined; symbol: string },
  asker: { service: string; asked: GraphEdge; symbol: string },
): { sender: ContractParty; receiver: ContractParty } => ({
  sender: party(lookup, handler.service, handler.handles?.returns, handler.symbol),
  receiver: party(lookup, asker.service, asker.asked.returns, asker.symbol),
});

/**
 * The kind of publish that waits for an answer.
 *
 * Every reader of a transport writes it on the producer, whether the call is a
 * request by its name — `client.send` — or by the callback it hands over. A
 * publish of any other kind expects nothing back, so it has no answer to be
 * compared or to be missing a type for.
 */
const REQUEST_KIND = 'rpc';

const asksForAnswer = (lookup: GraphLookup, emit: GraphEdge): boolean =>
  lookup.node(emit.from)?.kind === REQUEST_KIND;

/** A request a client made for a procedure, by what its reader wrote on it (R95, P242). */
const isProcedureRequest = (node: GraphNode | undefined): boolean =>
  node !== undefined && node.kind === 'rpc' && (node.type === 'ui_api_call' || node.type === 'http_out');

/** The signature a procedure's entry carries: the input a caller hands, and what it answers (P35, P247). */
const signatureOf = (entry: GraphNode | undefined): { input?: string; returns?: string } => {
  const signature = entry?.meta?.['signature'];
  if (signature === null || typeof signature !== 'object') return {};
  const { params, returns } = signature as { params?: unknown; returns?: unknown };
  const [first] = Array.isArray(params) ? (params as Array<{ type?: unknown }>) : [];
  return {
    ...(typeof first?.type === 'string' ? { input: first.type } : {}),
    ...(typeof returns === 'string' ? { returns } : {}),
  };
};

/**
 * The two directions of a request for a procedure (P247).
 *
 * Compared as a request and its answer are: what the caller hands - the type
 * of the argument written at the call, its keys where a literal is written -
 * against the input the procedure declares, the schema's input side; and what
 * the procedure answers against what the call reads back, where the call
 * returns it. Where an end says nothing to compare, the row says which end
 * and why, rather than a verdict that compared nothing: a procedure that
 * declares no input, an input schema whose type does not resolve here, an
 * input the call hands to something else, an answer handed to a cache.
 */
const procedureExchanges = (
  lookup: GraphLookup,
  edge: GraphEdge,
  both: (direction: Direction, sender: ContractParty, receiver: ContractParty) => Exchange,
  caller: { service: string; symbol: string },
  handler: { service: string; symbol: string },
): Exchange[] => {
  const asked = lookup.node(edge.from)?.meta ?? {};
  const entry = lookup.node(edge.to);
  const declared = signatureOf(entry);
  const schema = entry?.meta?.['input'];
  const written = asked['inputKeys'];
  const keys = Array.isArray(written) && written.every((key) => typeof key === 'string') ? (written as string[]) : undefined;

  const sender = {
    ...party(lookup, caller.service, edge.params?.[0], caller.symbol),
    ...(keys === undefined ? {} : { writes: keys, writesEvery: true }),
  };
  const receiver = party(lookup, handler.service, declared.input, handler.symbol);
  const inputBlocked: Blocked | undefined =
    typeof schema !== 'string' && declared.input === undefined
      ? { reason: 'procedure-input-undeclared', subject: edge.to }
      : !namesAShape(declared.input)
        ? { reason: 'procedure-input-unread', subject: edge.to, ...(typeof schema === 'string' ? { detail: schema } : {}) }
        : asked['inputLater'] === true
          ? { reason: 'procedure-input-not-at-call', subject: caller.symbol, detail: 'later' }
          : asked['inputNone'] === true
            ? { reason: 'procedure-input-not-at-call', subject: caller.symbol, detail: 'none' }
            : undefined;
  const request: Exchange = {
    ...both('request', sender, receiver),
    procedure: true,
    ...(inputBlocked === undefined ? {} : { blocked: inputBlocked }),
  };

  const answering = party(lookup, handler.service, declared.returns, handler.symbol);
  const reading = party(lookup, caller.service, edge.returns, caller.symbol);
  // No answer type on the request: the call hands the answer to a hook or a
  // query's options, typed there by the binding's inference (P58), or a gRPC
  // call to a callback whose answer is not typed (P287).
  const response: Exchange = {
    ...both('response', answering, reading),
    procedure: true,
    ...(typeof asked['outputType'] === 'string'
      ? {}
      : { blocked: { reason: 'procedure-output-inferred' as const, subject: edge.to, detail: asked['client'] === 'grpc' ? 'callback' : 'hook' } }),
  };
  return [request, response];
};

/** The strings a meta list holds, or nothing where it is not one. */
const stringsIn = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((each) => typeof each === 'string') ? (value as string[]) : undefined;

/** A key an address can carry, as the input's top-level field it fills: `filter[status]` fills `filter`. */
const topKey = (key: string): string => key.replace(/[[.].*$/, '');

/** The parameters a route's path names, as the procedure writes them: `{id}`, `{+path}`, `:id`. */
const pathParamsOf = (raw: string): string[] =>
  [...raw.matchAll(/\{\+?([A-Za-z_$][\w$]*)\}|:([A-Za-z_$][\w$]*)/g)].map((match) => (match[1] ?? match[2]) as string);

/**
 * The keys a query written in the address names (P256): `?status=open&limit=10`.
 * Nothing where the address has no query; `unread` where a part of it is not
 * a key written as text - a query string built elsewhere, spliced in.
 */
const queryOfAddress = (url: unknown, builtIn = false): { keys: string[] } | 'unread' | undefined => {
  if (typeof url !== 'string' || !url.includes('?')) return undefined;
  const query = url.slice(url.indexOf('?') + 1).split('#')[0] ?? '';
  const keys: string[] = [];
  for (const part of query.split('&')) {
    if (part === '') continue;
    // A query built in code and written in here, whose keys the reader recorded beside (P258).
    if (builtIn && /^\$\{[^}]*\}$/.test(part)) continue;
    const key = /^([A-Za-z_$][\w$\-[\].]*)(?:=|$)/.exec(part)?.[1];
    if (key === undefined) return 'unread';
    keys.push(topKey(key));
  }
  return { keys };
};

/** Presence only: a field the address carries as text, whatever the procedure coerces it to (D2). */
const present = (name: string): { name: string; optional: false; type: TypeRefAst } => ({ name, optional: false, type: { kind: 'primitive', name: 'unknown' } });

/** A shape written as fields, or nothing where it has none. */
const fieldsShape = (names: readonly string[]): TypeRefAst | undefined =>
  names.length === 0 ? undefined : { kind: 'object', fields: [...new Set(names)].map(present) };

/** Several parts of one input, as the one type they are together. */
const together = (parts: ReadonlyArray<TypeRefAst | undefined>): TypeRefAst | undefined => {
  const written = parts.filter((part): part is TypeRefAst => part !== undefined);
  if (written.length <= 1) return written[0];
  return { kind: 'intersection', members: written };
};

/** A reference as a shape, or nothing where it is not one that parses. */
const astOf = (ref: string | undefined): TypeRefAst | undefined => {
  if (!namesAShape(ref)) return undefined;
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/** The type of one field of a type, written in place or in the registry: a `detailed` output's `body` (P256). */
const fieldOfRef = (lookup: GraphLookup, ref: string | undefined, name: string): string | undefined => {
  const ast = astOf(ref);
  if (ast?.kind === 'object') {
    const found = ast.fields.find((field) => field.name === name);
    return found === undefined ? undefined : formatTypeRef(found.type);
  }
  if (ast?.kind === 'id') return lookup.type(ast.id)?.fields?.find((field) => field.name === name)?.type;
  return undefined;
};

/** The names of the fields of one field of a type: the headers a `detailed` input declares (P262). */
const fieldNamesOf = (lookup: GraphLookup, ref: string | undefined, name: string): string[] | undefined => {
  const field = astOf(fieldOfRef(lookup, ref, name));
  if (field?.kind === 'object') return field.fields.map((each) => each.name);
  if (field?.kind === 'id') return lookup.type(field.id)?.fields?.map((each) => each.name);
  return undefined;
};

/** What a field of no known type is: compared with nothing, and said so (`any-unknown-skip`). */
const UNKNOWN: TypeRefAst = { kind: 'primitive', name: 'unknown' };

/**
 * The headers a call sends to a `detailed` input that declares some (P262).
 *
 * A server hands a procedure every header lower-cased, and the call's names
 * are recorded so; only the ones the procedure declares are compared, since
 * a request carries headers its middleware, its proxy and its platform read
 * and no input names. Where the call's headers are not known - written in a
 * way that is not read, or added by something that runs before the request
 * (an instance's hook, an interceptor) - the part is `unknown`, which the
 * comparison skips and says, rather than calling a header missing that may be
 * sent. A call that writes none and runs through nothing that adds any sends
 * none.
 */
const headersSent = (asked: Record<string, unknown>, declared: readonly string[]): TypeRefAst => {
  if (asked['headersUnread'] === true) return UNKNOWN;
  const written = stringsIn(asked['headerKeys']) ?? [];
  const wanted = new Set(declared.map((name) => name.toLowerCase()));
  return { kind: 'object', fields: [...new Set(written.map((name) => name.toLowerCase()))].filter((name) => wanted.has(name)).map(present) };
};

/**
 * The headers a server's HTTP layer writes on an answer by itself (P265):
 * a caller reading one is not reading anything the procedure decides.
 */
const HTTP_LAYER_HEADERS: ReadonlySet<string> = new Set([
  'age',
  'cache-control',
  'connection',
  'content-encoding',
  'content-length',
  'content-type',
  'date',
  'etag',
  'expires',
  'keep-alive',
  'last-modified',
  'server',
  'transfer-encoding',
  'vary',
]);

/** What the headers of an answer compare: both ends' fields, the names said apart, and why. */
interface AnswerHeaders {
  readonly sent: TypeRefAst;
  readonly read: TypeRefAst;
  readonly missingRules: readonly MissingRule[];
  readonly rulesApplied: readonly string[];
  readonly via: readonly string[];
}

/**
 * The headers a caller reads off a `detailed` answer, against the ones the
 * procedure's output declares (P265).
 *
 * Compared from the caller's end, as the request's are from the
 * procedure's (P262): only the names the caller reads are compared, since an
 * answer carries headers no caller reads. A name the procedure declares
 * reaches the caller lower-cased, so a name read through `get` - looked up
 * whatever its case - agrees with it, and one read as a key with a capital is
 * never there. A name it reads that the procedure does not declare is
 * missing, said as one a middleware or the platform may still set (a
 * warning); one the HTTP layer writes by itself is not compared, and said.
 */
const answerHeaders = (declared: readonly string[], read: readonly string[], unread: boolean): AnswerHeaders => {
  const sent = new Set(declared.map((name) => name.toLowerCase()));
  const layer = read.filter((name) => HTTP_LAYER_HEADERS.has(name.toLowerCase()) && !sent.has(name.toLowerCase()));
  const compared = [...new Set(read.filter((name) => !layer.includes(name)))];
  const wanted = new Set(compared.map((name) => name.toLowerCase()));
  const undeclared = compared.filter((name) => !sent.has(name.toLowerCase()));
  const capitalised = compared.filter((name) => name !== name.toLowerCase() && sent.has(name.toLowerCase()));
  return {
    sent: { kind: 'object', fields: [...sent].filter((name) => wanted.has(name)).map(present) },
    read: { kind: 'object', fields: compared.map(present) },
    missingRules:
      undeclared.length === 0
        ? []
        : [{ path: 'headers', names: undeclared, rule: 'header-not-declared', note: "the procedure's output does not declare it, so it is not sent unless a middleware or the platform sets it" }],
    rulesApplied: [...layer.map((name) => `http-layer-header:headers.${name}`), ...(unread ? ['any-unknown-skip:headers'] : [])],
    via:
      capitalised.length === 0
        ? []
        : [`a client hands every response header lower-cased, so ${capitalised.map((name) => `\`headers.${name}\``).join(' and ')} read as a key is never there`],
  };
};

/**
 * A plain request to a procedure's REST route, both ways (P256).
 *
 * The OpenAPI handler hands the procedure one input assembled from the
 * request: with the default structure, the route's path parameters merged
 * with the query for a `GET` and with the body for any other verb; with the
 * `detailed` one, `{ params, query, headers, body }`. So the caller's half is
 * assembled the same way from what it writes, and compared with the
 * procedure's input by the rules any request body is: a path parameter and a
 * query key by name alone (the address carries text, and whether the schema
 * coerces it is the schema's to say, D2), the body field by field. What the
 * call reads back is compared with the procedure's output, or the output's
 * `body` for a `detailed` one. Where a part cannot be read - a query built
 * elsewhere, a body with no type - the row says so rather than calling the
 * procedure's required keys missing.
 */
const twinExchanges = (
  lookup: GraphLookup,
  edge: GraphEdge,
  both: (direction: Direction, sender: ContractParty, receiver: ContractParty) => Exchange,
  caller: { service: string; symbol: string },
  handler: { service: string; symbol: string },
): Exchange[] => {
  const entry = lookup.node(edge.to);
  const route = entry?.meta ?? {};
  const asked = lookup.node(edge.from)?.meta ?? {};
  const declared = signatureOf(entry);
  const schema = route['input'];
  const detailedIn = route['inputStructure'] === 'detailed';
  const detailedOut = route['outputStructure'] === 'detailed';
  const verb = typeof route['method'] === 'string' ? route['method'].toUpperCase() : 'POST';
  const params = pathParamsOf(typeof route['rawPath'] === 'string' ? route['rawPath'] : '');

  // The query: keys the address writes, and what the call's options hand under their query option.
  const addressed = queryOfAddress(asked['url'], asked['queryInAddress'] === true);
  const optionKeys = stringsIn(asked['queryKeys'])?.map(topKey);
  const optionType = typeof asked['queryType'] === 'string' ? asked['queryType'] : undefined;
  const queryUnread = addressed === 'unread' || asked['queryUnread'] === true || (optionType !== undefined && optionKeys === undefined && !namesAShape(optionType));
  const queryKeys = [...(addressed === undefined || addressed === 'unread' ? [] : addressed.keys), ...(optionKeys ?? [])];
  const queryShape = together([fieldsShape(queryKeys), optionKeys === undefined ? astOf(optionType) : undefined]);
  const queryKnown = optionType === undefined || optionKeys !== undefined;

  // The body, where the verb carries one.
  const bodyRef = edge.params?.[0];
  const bodyWritten = typeof asked['bodyType'] === 'string' || namesAShape(bodyRef);
  const bodyKeys = stringsIn(asked['bodyKeys']);
  const bodyShape = astOf(bodyRef);
  const usesQuery = detailedIn || verb === 'GET';
  const usesBody = detailedIn || verb !== 'GET';

  // `detailed`: each part the call writes under its own key, the headers by
  // the names it writes (P258) where the procedure declares any, compared
  // from its end (P262); a part nothing writes is not sent.
  const declaredHeaders = detailedIn ? fieldNamesOf(lookup, declared.input, 'headers') : undefined;
  const headersPart = declaredHeaders === undefined ? undefined : headersSent(asked, declaredHeaders);
  const parts: Array<[string, TypeRefAst | undefined]> = [
    ['params', fieldsShape(params)],
    ['query', queryShape],
    ['headers', headersPart],
    ['body', bodyShape],
  ];
  // A name the procedure spells with a capital is never handed to it as spelled.
  const capitalised = (declaredHeaders ?? []).filter((name) => name !== name.toLowerCase());
  const sentParts = parts.filter((part): part is [string, TypeRefAst] => part[1] !== undefined);
  const sent = detailedIn
    ? sentParts.length === 0
      ? undefined
      : ({ kind: 'object', fields: sentParts.map(([name, type]) => ({ name, optional: false, type })) } as TypeRefAst)
    : together([fieldsShape(params), usesQuery ? queryShape : undefined, usesBody ? bodyShape : undefined]);

  // The keys the call writes, where every part it writes says them.
  const writes = detailedIn
    ? sentParts.map(([name]) => name)
    : [
        ...params,
        ...(usesQuery && queryKnown ? queryKeys : []),
        ...(usesBody && bodyWritten ? (bodyKeys ?? []) : []),
      ];
  const everyPartKnown = detailedIn || ((!usesQuery || queryKnown) && (!usesBody || !bodyWritten || bodyKeys !== undefined));
  const literalBody = asked['bodyFrom'] === undefined || asked['bodyFrom'] === 'literal';

  const sender: ContractParty = {
    ...party(lookup, caller.service, sent === undefined ? '{}' : formatTypeRef(sent), caller.symbol),
    ...(everyPartKnown ? { writes: [...new Set(writes)], writesEvery: literalBody } : {}),
  };
  const receiver = party(lookup, handler.service, declared.input, handler.symbol);
  const inputBlocked: Blocked | undefined =
    typeof schema !== 'string' && declared.input === undefined
      ? { reason: 'procedure-input-undeclared', subject: edge.to }
      : !namesAShape(declared.input)
        ? { reason: 'procedure-input-unread', subject: edge.to, ...(typeof schema === 'string' ? { detail: schema } : {}) }
        : usesQuery && queryUnread
          ? { reason: 'procedure-input-by-name', subject: caller.symbol, detail: 'query' }
          : usesBody && bodyWritten && bodyShape === undefined
            ? { reason: 'no-type-on-sender', subject: caller.symbol }
            : undefined;
  const request: Exchange = {
    ...both('request', sender, receiver),
    ...(sent === undefined ? { sendsNothing: true } : {}),
    ...(headersPart?.kind === 'object' && headersPart.fields.length === 0 ? { writtenEmptyAt: ['headers'] } : {}),
    ...(inputBlocked === undefined ? {} : { blocked: inputBlocked }),
    ...(capitalised.length === 0
      ? {}
      : { via: [`a server hands a procedure every header lower-cased, so ${capitalised.map((name) => `\`headers.${name}\``).join(' and ')} it declares is never handed to it as spelled`] }),
  };

  // The answer: the procedure's output, or its body, against what the call reads back.
  const output = detailedOut ? fieldOfRef(lookup, declared.returns, 'body') : declared.returns;
  // With the headers the caller reads, where the output declares some (P265).
  const declaredOut = detailedOut ? fieldNamesOf(lookup, declared.returns, 'headers') : undefined;
  const readOff = stringsIn(asked['responseHeaderKeys']) ?? [];
  const headersOut = declaredOut === undefined || readOff.length === 0 ? undefined : answerHeaders(declaredOut, readOff, asked['responseHeadersUnread'] === true);
  if (headersOut !== undefined) {
    // Both parts under their own keys: a body neither end says is compared with nothing, and said.
    const whole = (headers: TypeRefAst, body: string | undefined): TypeRefAst => ({
      kind: 'object',
      fields: [
        { name: 'headers', optional: false, type: headers },
        { name: 'body', optional: false, type: astOf(body) ?? UNKNOWN },
      ],
    });
    const response: Exchange = {
      ...both('response', party(lookup, handler.service, formatTypeRef(whole(headersOut.sent, output)), handler.symbol), party(lookup, caller.service, formatTypeRef(whole(headersOut.read, edge.returns)), caller.symbol)),
      // None of the names read is declared: the procedure's headers are an object written with none of them.
      ...(headersOut.sent.kind === 'object' && headersOut.sent.fields.length === 0 ? { writtenEmptyAt: ['headers'] } : {}),
      ...(headersOut.missingRules.length === 0 ? {} : { missingRules: headersOut.missingRules }),
      ...(headersOut.rulesApplied.length === 0 ? {} : { rulesApplied: headersOut.rulesApplied }),
      ...(headersOut.via.length === 0 ? {} : { via: [...headersOut.via] }),
    };
    return [request, response];
  }
  const answering = party(lookup, handler.service, output, handler.symbol);
  const reading = party(lookup, caller.service, edge.returns, caller.symbol);
  const answerBlocked: Blocked | undefined = !namesAShape(edge.returns)
    ? { reason: 'no-type-on-receiver', subject: caller.symbol }
    : !namesAShape(output)
      ? { reason: 'no-type-on-sender', subject: handler.symbol }
      : undefined;
  const response: Exchange = { ...both('response', answering, reading), ...(answerBlocked === undefined ? {} : { blocked: answerBlocked }) };
  return [request, response];
};

/**
 * Both halves of a request, whichever way the request was made.
 *
 * A call between services and a request from a browser differ in what wrote
 * them down and in nothing else that matters here: the same three fields on the
 * edge, the same handler on the far side, the same two things that can be wrong.
 */
const requestExchanges = (lookup: GraphLookup, edge: GraphEdge): Exchange[] => {
  const shape = { from: edge.from, to: edge.to, type: edge.type };
  const edgeKey = edgeKeyOf(edge);
  const callerService = repoOf(lookup, edge.from);
  const caller = callerOf(lookup, edge.from);
  const handlerService = repoOf(lookup, edge.to);
  const handles = handlesOf(lookup, edge.to);
  const handler = handlerOf(handles[0], edge.to);

  const both = (direction: Direction, sender: ContractParty, receiver: ContractParty): Exchange => ({
    edge: shape,
    edgeKey,
    direction,
    sender,
    receiver,
    symbols: [caller, handler],
  });

  // A procedure asked for by its path (P247): the caller's input against the
  // input the procedure declares, and what it answers against what the caller
  // reads back, each where both ends say a type. Never the handler's own
  // parameters, which are a context and an envelope rather than what the
  // caller sends.
  if (isProcedureRequest(lookup.node(edge.from))) {
    return procedureExchanges(lookup, edge, both, { service: callerService, symbol: caller }, { service: handlerService, symbol: handler });
  }
  // A route that answers for a procedure (P58) is the same boundary reached by
  // its address: its handler is handed the same envelope, and the route
  // carries the procedure's input by name, assembled from the path, the query
  // and the body, which a request's body alone is not compared with.
  if (typeof lookup.node(edge.to)?.meta?.['procedure'] === 'string') {
    // A plain request is compared with the input the route assembles from
    // what it writes, and its own answer type with the procedure's (P256).
    const client = typeof lookup.node(edge.from)?.meta?.['procedure'] === 'string';
    if (!client) return twinExchanges(lookup, edge, both, { service: callerService, symbol: caller }, { service: handlerService, symbol: handler });
    const input = lookup.node(edge.to)?.meta?.['input'];
    const callerParty = party(lookup, callerService, undefined, caller);
    const handlerParty = party(lookup, handlerService, undefined, handler);
    // A procedure's client reaching the route is typed from the server's tree
    // (P252), and its input is the client's, not the route's.
    const answered: Blocked = { reason: 'procedure-output-inferred' as const, subject: edge.to };
    return [
      {
        ...both('request', callerParty, handlerParty),
        blocked: {
          reason: 'procedure-input-by-name' as const,
          subject: edge.to,
          ...(typeof input === 'string' ? { detail: input } : {}),
        },
      },
      { ...both('response', handlerParty, callerParty), blocked: answered },
    ];
  }

  if (handles.length > 1) {
    const blocked = {
      reason: 'ambiguous-handler' as const,
      subject: edge.to,
    };
    return (['request', 'response'] as const).map((direction) => ({
      ...both(
        direction,
        party(lookup, callerService, undefined, caller),
        party(lookup, handlerService, undefined, edge.to),
      ),
      blocked,
    }));
  }

  const sender = lookup.node(edge.from)?.meta;
  const written = sender?.['bodyKeys'];
  const readable = Array.isArray(written) && written.every((key) => typeof key === 'string');
  const described = handles[0]?.meta?.[REQUEST_READ_META] === true ? { described: true } : {};
  const request = both(
    'request',
    {
      ...party(lookup, callerService, edge.params?.[0], caller),
      ...(readable
        ? { writes: written as string[], writesEvery: sender?.['bodyFrom'] === 'literal' }
        : {}),
    },
    { ...party(lookup, handlerService, bodyTypeOf(handles[0]), handler), ...claimedOf(handles[0], 'body') },
  );
  const replied = answer(
    lookup,
    { service: handlerService, handles: handles[0], symbol: handler },
    { service: callerService, asked: edge, symbol: caller },
  );
  const response = both('response', { ...replied.sender, ...claimedOf(handles[0], 'response') }, replied.receiver);
  const unknownStatus = handles[0]?.meta?.[STATUS_UNKNOWN_META];
  return [
    { ...request, ...described },
    { ...response, ...described, ...(typeof unknownStatus === 'string' ? { statusUnknown: unknownStatus } : {}) },
  ];
};

/**
 * `claimed` for an end whose type only a cast in the handler states (P29): what
 * the author says the body is, which nothing checked.
 */
const claimedOf = (handles: GraphEdge | undefined, part: string): { claimed?: true } => {
  const claimed = handles?.meta?.[CLAIMED_META];
  return Array.isArray(claimed) && claimed.includes(part) ? { claimed: true } : {};
};

/** The entry point a consumer answers, which is where its payload type is. */
const entryOfConsumer = (lookup: GraphLookup, consumer: GraphNode): GraphEdge | undefined => {
  const declared = consumer.meta?.['entryId'];
  const method = lookup.edgesFrom(consumer.id, ['handles'])[0]?.to;
  if (typeof declared === 'string') {
    const handles = lookup.edgesFrom(declared, ['handles']);
    const found = handles.find((edge) => edge.to === method) ?? handles[0];
    if (found !== undefined) return found;
  }
  if (method === undefined) return undefined;
  return lookup
    .edgesTo(method, ['handles'])
    .find((edge) => lookup.node(edge.from)?.type === 'entry');
};

/** One end read through a wrapping: the party, and whatever stopped it being compared. */
interface Delivered {
  receiver: ContractParty;
  blocked?: Blocked;
  carriesOn: boolean;
  via?: string[];
}

const deployed = (node: GraphNode): boolean => typeof node.meta?.['deployedBy'] === 'string';

const viaOf = (clauses: string[] | undefined): { via?: string[] } =>
  clauses === undefined || clauses.length === 0 ? {} : { via: clauses };

/** The channels a publisher sends to, for a sentence that says where a message went on to. */
const channelsOf = (lookup: GraphLookup, producer: string): string =>
  lookup
    .edgesFrom(producer, ['emits'])
    .map((edge) => edge.to)
    .sort()
    .join(', ');

/** The code an entry runs, read through the wrapping the message is handed to it in. */
const throughEnvelope = (lookup: GraphLookup, wrapper: GraphNode, entry: GraphNode): Delivered => {
  const envelope = envelopeOf(wrapper);
  // The reader that drew the delivery says how it wraps the message, or says
  // nothing because that is not known; why is that reader's to say.
  if (envelope === undefined) {
    return {
      receiver: party(lookup, entry.repo, undefined, entry.id),
      blocked: { reason: 'envelope-unread', subject: wrapper.id },
      carriesOn: false,
    };
  }
  const reading = readThrough(lookup, entry, envelope);
  return {
    receiver: party(lookup, entry.repo, reading.typeId, reading.symbol),
    ...(reading.blocked === undefined ? {} : { blocked: reading.blocked }),
    carriesOn: reading.carriesOn,
    via: reading.via,
  };
};

/**
 * Who a consumer a deployment declares hands the message to, and what that
 * reads of it.
 *
 * Such a consumer has no handler of its own: it is a delivery, and the code it
 * runs is the function or the workflow it reaches. `undefined` for a consumer
 * that is neither, which is read as it always was.
 */
const deliveredTo = (lookup: GraphLookup, consumer: GraphNode): Delivered | undefined => {
  const target = lookup
    .edgesFrom(consumer.id, ['calls'])
    .map((edge) => lookup.node(edge.to))
    .filter((node): node is GraphNode => node !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const blocked = (reason: Blocked['reason'], detail?: string): Delivered => ({
    receiver: party(lookup, consumer.repo, undefined, consumer.id),
    blocked: { reason, subject: consumer.id, ...(detail === undefined || detail === '' ? {} : { detail }) },
    carriesOn: false,
  });
  if (target === undefined) return deployed(consumer) ? blocked('delivery-target-unread') : undefined;
  if (target.type === 'producer') return blocked('delivered-onward', channelsOf(lookup, target.id));
  if (target.type !== 'entry') return blocked('delivery-target-unread');
  return throughEnvelope(lookup, consumer, target);
};

/**
 * Why a sending end has nothing to compare, said before anything about the
 * receiving end, the way a sender with no type always was: a delivery or a
 * route that hands on what it was given has no type of its own to declare.
 */
const unsent = (
  lookup: GraphLookup,
  producer: GraphNode | undefined,
  sent: string | undefined,
  symbol: string,
): Blocked | undefined => {
  if (namesAShape(sent)) return undefined;
  return producer !== undefined && deployed(producer)
    ? { reason: 'sender-forwards', subject: producer.id }
    : { reason: 'no-type-on-sender', subject: symbol };
};

/** A publisher whose message a delivery forwards, with the message as it is forwarded. */
interface Upstream {
  emit: GraphEdge;
  typeId: string;
  /** The service whose delivery forwards it. */
  forwarder: string;
  envelope: Envelope;
}

/** What a forwarding delivery does to the message, as a comparison through it says. */
const handedOn = ({ forwarder, envelope }: Upstream): string => {
  const path = envelopePath(envelope.at);
  if (path === '' && !envelope.text) return `${forwarder} hands it on as it was sent`;
  return `${forwarder} hands it on as it is delivered, the message at ${path === '' ? 'the top' : path}${envelope.text ? ' as text' : ''}`;
};

/**
 * Where a message a delivery forwards came from, wrapped as the delivery hands it on.
 *
 * One hop: a publisher that itself forwards is not followed further back.
 */
const forwardedFrom = (lookup: GraphLookup, forwarder: string): Upstream[] =>
  lookup
    .edgesTo(forwarder, ['calls'])
    .map((edge) => lookup.node(edge.from))
    .filter((node): node is GraphNode => node?.type === 'consumer')
    .flatMap((consumer) => {
      const envelope = envelopeOf(consumer);
      if (envelope === undefined) return [];
      return lookup.edgesTo(consumer.id, ['consumes']).flatMap((consume) =>
        lookup.edgesTo(consume.from, ['emits']).flatMap((emit) => {
          const sent = emit.params?.[0];
          const typeId = namesAShape(sent) ? wrapped(sent, envelope) : undefined;
          return typeId === undefined
            ? []
            : [{ emit, typeId, forwarder: consumer.repo, envelope }];
        }),
      );
    })
    .sort((a, b) => (a.emit.from < b.emit.from ? -1 : a.emit.from > b.emit.from ? 1 : 0));

/**
 * A published message and the handler that reads it.
 *
 * There is no edge between the two: they meet on the channel, which is one node
 * for the whole project by design. The contract is still between the two of
 * them and not between either and the channel, so the pair is what gets a key.
 */
const channelExchanges = (lookup: GraphLookup, channel: GraphNode): Exchange[] => {
  const emits = lookup.edgesTo(channel.id, ['emits']);
  const consumes = lookup.edgesFrom(channel.id, ['consumes']);

  if (emits.length === 0 || consumes.length === 0) {
    if (emits.length === 0 && consumes.length === 0) return [];
    const reason: UncheckedReason =
      emits.length === 0 ? 'channel-without-producer' : 'channel-without-consumer';
    const side = emits[0] ?? consumes[0];
    const end = emits.length === 0 ? (consumes[0]?.to ?? channel.id) : (emits[0]?.from ?? channel.id);
    return [
      {
        edge: { from: side?.from ?? channel.id, to: side?.to ?? channel.id, type: side?.type ?? 'emits' },
        edgeKey: `${channel.id}|${emits.length === 0 ? 'consumes' : 'emits'}|${end}`,
        direction: 'payload',
        sender: party(lookup, repoOf(lookup, end), undefined, end),
        receiver: party(lookup, repoOf(lookup, end), undefined, end),
        symbols: [],
        blocked: { reason, subject: channel.id },
      },
    ];
  }

  const found: Exchange[] = [];
  for (const emit of emits) {
    const publisher = callerOf(lookup, emit.from);
    const publisherService = repoOf(lookup, emit.from);
    const producer = lookup.node(emit.from);
    // A delivery that hands on what it was delivered sends nothing of its own:
    // what it sends is its publishers' messages, wrapped.
    const upstream = emit.params?.[0] === undefined ? forwardedFrom(lookup, emit.from) : [];
    for (const consume of consumes) {
      const consumer = lookup.node(consume.to);
      if (consumer === undefined) continue;
      const handles = entryOfConsumer(lookup, consumer);
      const delivered = handles === undefined ? deliveredTo(lookup, consumer) : undefined;
      const handler = delivered?.receiver.symbol ?? handles?.to ?? consume.to;
      const handlerService = consumer.repo;
      const receiver =
        delivered?.receiver ?? party(lookup, handlerService, bodyTypeOf(handles) ?? handles?.params?.[0], handler);
      const through = delivered?.carriesOn === true ? { carriesOn: true } : {};
      // Keyed by the publisher that wrote the message and the handler that
      // reads it, like any message on a channel: the forwarding is the medium.
      for (const from of upstream) {
        const shape = { from: from.emit.from, to: consume.to, type: 'emits' };
        const origin = callerOf(lookup, from.emit.from);
        found.push({
          edge: shape,
          edgeKey: edgeKeyOf(shape),
          direction: 'payload',
          sender: party(lookup, repoOf(lookup, from.emit.from), from.typeId, origin),
          receiver,
          symbols: [origin, handler],
          ...through,
          ...(delivered?.blocked === undefined ? {} : { blocked: delivered.blocked }),
          ...(from.envelope.beside === undefined ? {} : { wrapperKeys: from.envelope.beside }),
          via: [handedOn(from), ...(delivered?.via ?? [])],
        });
      }
      if (upstream.length > 0) continue;
      const shape = { from: emit.from, to: consume.to, type: 'emits' };
      const edgeKey = edgeKeyOf(shape);
      const blocked = unsent(lookup, producer, emit.params?.[0], publisher) ?? delivered?.blocked;
      found.push({
        edge: shape,
        edgeKey,
        direction: 'payload',
        sender: party(lookup, publisherService, emit.params?.[0], publisher),
        receiver,
        symbols: [publisher, handler],
        ...through,
        ...(blocked === undefined ? {} : { blocked }),
        ...viaOf(delivered?.via),
      });
      // A request and an answer, over a channel. The kind of the publish says
      // whether there is an answer at all; whether either end declares its type
      // is the comparison's to say, in the words it says it for a route.
      if (asksForAnswer(lookup, emit)) {
        found.push({
          edge: shape,
          edgeKey,
          direction: 'response',
          ...answer(
            lookup,
            { service: handlerService, handles, symbol: handler },
            { service: publisherService, asked: emit, symbol: publisher },
          ),
          symbols: [publisher, handler],
        });
      }
    }
  }
  return found;
};

/**
 * A call that starts a workflow or invokes a function by its deployed name,
 * and what that reads of what it is handed (R172).
 *
 * The start is a request: the caller hands over its input and the far end
 * reads it, through the wrapping the call says it is handed in. Its answer,
 * where there is one, is bytes nobody here declares, so only the request is
 * compared.
 */
const startExchanges = (lookup: GraphLookup, producer: GraphNode): Exchange[] =>
  lookup.edgesFrom(producer.id, ['calls']).flatMap((call) => {
    const entry = lookup.node(call.to);
    if (entry?.type !== 'entry') return [];
    const caller = callerOf(lookup, producer.id);
    const said = producer.meta?.['payload'];
    const sent = typeof said === 'string' ? said : undefined;
    const delivered = throughEnvelope(lookup, producer, entry);
    const blocked = unsent(lookup, producer, sent, caller) ?? delivered.blocked;
    const shape = { from: producer.id, to: entry.id, type: call.type };
    return [
      {
        edge: shape,
        edgeKey: edgeKeyOf(shape),
        direction: 'request' as const,
        sender: party(lookup, producer.repo, sent, caller),
        receiver: delivered.receiver,
        symbols: [caller, delivered.receiver.symbol],
        ...(blocked === undefined ? {} : { blocked }),
        ...(delivered.carriesOn ? { carriesOn: true } : {}),
        ...viaOf(delivered.via),
      },
    ];
  });

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every boundary in the project, in an order that does not depend on the graph.
 *
 * Sorted here rather than at the end, so the report is the same document
 * whichever order the edges came out of the store in.
 */
export const boundaries = (lookup: GraphLookup): Exchange[] => {
  const found: Exchange[] = [];
  for (const edge of lookup.allEdges()) {
    if (edge.type === 'http_calls' || edge.type === 'hits') {
      // A GraphQL operation's contract is its selection against the schema
      // (`graphql.ts`), not a body and an answer typed in code (P232).
      if (lookup.node(edge.from)?.meta?.['graphql'] !== undefined) continue;
      found.push(...requestExchanges(lookup, edge));
    }
  }
  for (const channel of lookup.nodesByType('channel')) {
    found.push(...channelExchanges(lookup, channel));
  }
  for (const producer of lookup.nodesByType('producer')) {
    if (typeof producer.meta?.[STARTS_META] === 'string') found.push(...startExchanges(lookup, producer));
  }
  return found.sort(
    (a, b) =>
      cmp(a.edgeKey, b.edgeKey) ||
      cmp(a.direction, b.direction) ||
      cmp(a.receiver.symbol, b.receiver.symbol),
  );
};
