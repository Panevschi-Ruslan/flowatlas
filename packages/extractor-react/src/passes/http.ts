import {
  applicationOfFile,
  builtQueryInAddress,
  builtQueryOf,
  forEachCall,
  makeExternalApiId,
  isPlatformProvided,
  makeLeafId,
  normalizeFilePath,
  optionVerbAlong,
  optionVerbOf,
  portWithoutColonRow,
  requestBodyOf,
  requestVerbOf,
  resolveTypeOrigin,
  siteOf,
  verbAlong,
  verbParameterOf,
  verbsAtCallers,
  UNREAD_SPAN,
  wasRead,
  writtenKeysOf,
  describedRequestsAt,
  evaluateExpression,
  fieldWrittenOutside,
  fieldWritesOutside,
  PLATFORM_FETCH,
  PLATFORM_HEADERS,
  PLATFORM_QUERY,
  writtenHeaderNames,
  responseHeadersRead,
  precedenceOf,
  precedenceRows,
  toPosixPath,
  type DescribedRequest,
  type TypeOrigin,
} from '@flowatlas/core';
import { documentOf, fetchedQuery, GRAPHQL_META, handedThrough, operationMeta, operationsOf } from '@flowatlas/graphql';
import type { CallExpression, ClassDeclaration, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  AXIOS,
  BASE_FIELDS,
  CLIENT_FACTORIES,
  FETCH,
  KY,
  OFETCH,
  REQUEST_CLIENTS,
  VERB_CALLS,
  type CallShape,
  type ClientFactory,
  type RequestClient,
} from '../clients.js';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { clientInstances, isBarePageGlobal, undeclaredPageGlobal, type ClientInstance } from '../util/client-instance.js';
import { classMethods, enclosingIndexed, requestsOf, type ReadRequest, type RequestSite } from '../util/forward.js';
import { instanceBaseOf, localClientOf, type ClassReading, type LocalClientReading } from '../util/local-client.js';
import { linterGlobals, pageLoadedPackages } from '../util/page-globals.js';
import { basedBy, rewriteFor, unreadOpening } from '../util/request-rewrite.js';
import { placedOut, receiverValues, valuesAlong } from '../util/receiver-values.js';
import { sentThrough } from '../util/sent-later.js';
import { analyzeApiUrl, analyzeClientBase, isSomewhere, underBase, type ApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/** One request found in the source, before its address has been worked out. */
interface FoundCall {
  call: CallExpression;
  client: RequestClient;
  shape: CallShape;
  /**
   * How a client of this repository's own came to be read as one, when it is one.
   *
   * Absent for the two installed clients, where there is nothing to say: the
   * question of whether `axios` is a client does not arise. For a class a
   * project wrote, it does, and whoever reads a request node should be able to
   * see whether the tool worked it out or was told (R87).
   */
  local?: 'declared' | 'recognised';
  /**
   * The client the configuration describes, when the call is one
   * (`adapters.http.clients`, P121): its verb, address and body are where the
   * description says, not where a shape's indexes would put them.
   */
  described?: DescribedRequest;
  /**
   * The instance of an installed client the call is made through, when it was
   * followed to where it is made (P239): its base is the client's for this call.
   */
  instance?: ClientInstance;
  /**
   * The instances a receiver the compiler knows nothing of is handed, each
   * with where it is handed, where they are made with different bases
   * (P312): one request is read per caller that hands them, under its own.
   */
  held?: readonly { readonly instance: ClientInstance; readonly at: TsNode }[];
}

/** The object written in place at an argument, when one was. */
const objectAt = (call: CallExpression, index: number | undefined): ObjectLiteralExpression | undefined => {
  if (index === undefined) return undefined;
  const argument = call.getArguments()[index];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

/** The value written for a key of an object, when the object writes it. */
const valueOf = (object: ObjectLiteralExpression | undefined, key: string): TsNode | undefined => {
  const property = object?.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/**
 * The address a call writes: the argument its shape names, or the key of its
 * one options object the address is written under (P244), `api({ url })`.
 */
const addressWrittenIn = (call: CallExpression, shape: CallShape): TsNode | undefined => {
  if (shape.urlKey === undefined) return call.getArguments()[shape.urlAt];
  const property = objectAt(call, shape.optionsAt)?.getProperty(shape.urlKey);
  if (property === undefined) return undefined;
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/**
 * The option a call writes its verb under (P311): the first of its shape's
 * that its options write, the first of them where none is written, the
 * platform's `method` where the shape names none.
 */
const verbKeyOf = (call: CallExpression, shape: CallShape): string => {
  const keys = shape.verbKeys;
  if (keys === undefined || keys.length === 0) return PLATFORM_FETCH.verbKey;
  const object = shape.optionsAt === undefined ? undefined : objectAt(call, shape.optionsAt);
  return keys.find((key) => object?.getProperty(key) !== undefined) ?? keys[0] ?? PLATFORM_FETCH.verbKey;
};

/**
 * A call's shape, or the shape of the same call handed one settings object in
 * place of an address (P311), or handed the address alone in place of a verb
 * and an address (P317): `request(url)` beside `request('POST', url)`.
 */
const settledShape = (call: CallExpression, shape: CallShape): CallShape => {
  const [first, second] = call.getArguments();
  if (shape.settings !== undefined && first !== undefined && Node.isObjectLiteralExpression(first)) return shape.settings;
  const callback = second !== undefined && (Node.isArrowFunction(second) || Node.isFunctionExpression(second));
  return shape.alone !== undefined && first !== undefined && (second === undefined || callback) ? shape.alone : shape;
};

/** Whether a node is a function written in place: a callback where a body or a query may also be handed (P317). */
const isWrittenFunction = (node: TsNode): boolean => Node.isArrowFunction(node) || Node.isFunctionExpression(node);

/** How many calls of a chain are walked along for the one that hands the body. */
const CHAIN_LIMIT = 8;

/**
 * The first argument of `.method(...)` called further along the chain a call
 * starts (P311): `send` of `request.post(url).set(headers).send(order)`.
 */
const chainedArgument = (call: CallExpression, method: string): TsNode | undefined => {
  let at: TsNode = call;
  for (let step = 0; step < CHAIN_LIMIT; step += 1) {
    const access = at.getParent();
    if (access === undefined || !Node.isPropertyAccessExpression(access) || access.getExpression() !== at) return undefined;
    const next = access.getParent();
    if (next === undefined || !Node.isCallExpression(next) || next.getExpression() !== access) return undefined;
    if (access.getName() === method) return next.getArguments()[0];
    at = next;
  }
  return undefined;
};

/** Every verb an instance of an installed client answers to as a method (P239). */
const INSTANCE_VERBS: ReadonlySet<string> = new Set(CLIENT_FACTORIES.flatMap((factory) => Object.keys(factory.verbs)));

/** Whether a receiver's type is one of the ones a client is spelled on. */
const isClientValue = (origin: TypeOrigin | null, client: RequestClient): boolean =>
  origin !== null &&
  client.receiver?.types.some(
    (type) => type.typeName === origin.typeName && type.package === origin.package,
  ) === true;

/**
 * Requests the browser makes.
 *
 * Where Angular has one client whose type the compiler knows, this has a table
 * of spellings and no help at all from the type system for the commonest of
 * them. What comes out is the same node either way — a verb, an address, and
 * the types on both sides of it — because everything downstream of here is
 * framework-independent and was proved so by the other reader.
 */
/** What builds a query in code in a browser: the platform's own (P258). */
const QUERY_BUILDERS = [PLATFORM_QUERY];

export const httpPass = definePass('http', (ctx: ReactExtractContext) => {
  const apiBaseEnv = ctx.service.apiBaseEnv ?? [];

  /**
   * The verb one call sends: the one its spelling always means, or, where the
   * spelling leaves it to the call, the one the platform's description reads out
   * of the options — including null where they were assembled elsewhere, which
   * is a row rather than a guess at `GET` (R140).
   */
  const verbOf = (call: CallExpression, shape: CallShape, chain: readonly CallExpression[] = []): string | null => {
    if (shape.method !== null) return shape.method;
    // Written as text in an argument of its own (P284).
    if (shape.methodAt !== undefined) {
      const written = call.getArguments()[shape.methodAt];
      const value = written === undefined ? undefined : evaluateExpression(written);
      return value?.resolved === true && typeof value.value === 'string' ? value.value.toUpperCase() : null;
    }
    const read = requestVerbOf(call, { ...PLATFORM_FETCH, optionsAt: shape.optionsAt ?? PLATFORM_FETCH.optionsAt, verbKey: verbKeyOf(call, shape) });
    if (read !== null || chain.length === 0) return read;
    // A verb the wrapper is handed, read at the caller its address was read
    // at, along the same calls (P91); or a member of the options it is
    // handed, with the default it falls back to (R179).
    const written = verbWrittenIn(call, shape);
    const parameter = verbParameterOf(written);
    if (parameter !== undefined) return verbAlong(parameter, chain) ?? null;
    const option = optionVerbOf(written);
    return option === undefined ? null : (optionVerbAlong(option, chain) ?? null);
  };

  /** Where a call writes its verb, when it writes one in its options. */
  const verbWrittenIn = (call: CallExpression, shape: CallShape): TsNode | undefined => {
    if (shape.method !== null || shape.optionsAt === undefined) return undefined;
    return objectAt(call, shape.optionsAt)?.getProperty(verbKeyOf(call, shape));
  };

  const typeOfResponse = (call: CallExpression): string | null => {
    const [written] = call.getTypeArguments();
    return written === null || written === undefined
      ? null
      : ctx.types.collectType(written.getType(), call);
  };

  /**
   * The body a request's receiver is handed after the call that opens it
   * (P294): the first argument of the first `<receiver>.<method>(...)` written
   * after it in the function that opens it, or where the receiver is followed
   * to - another method sending the field it is kept in, the function it is
   * handed to, the caller it is returned to (P296) - looked through its
   * serialisation as `fetch`'s is. `undefined` where it is sent with none, or
   * not sent anywhere read.
   */
  const sentBodyOf = (call: CallExpression, method: string): TsNode | undefined => {
    const written = sentThrough(call, method)?.getArguments()[0];
    if (written === undefined || !Node.isCallExpression(written)) return written;
    const serialiser = written.getExpression();
    return Node.isPropertyAccessExpression(serialiser) && PLATFORM_FETCH.serialisers.includes(serialiser.getName()) ? (written.getArguments()[0] ?? written) : written;
  };

  /**
   * Where the fallback of the setting an address is rooted at is written,
   * where that is another module than the request's (P296): a chain of `||`
   * in a constants module is that module's.
   */
  const defaultFromOf = (address: ApiUrl, file: string): { baseUrlDefaultFrom?: string } => {
    if (address.baseUrlEnv === null || address.baseUrlDefault === undefined || address.baseUrlDefaultFile === undefined) return {};
    const from = normalizeFilePath(address.baseUrlDefaultFile, ctx.repoDir);
    return from === file ? {} : { baseUrlDefaultFrom: from };
  };

  /**
   * The shape a request puts on the wire.
   *
   * Two spellings, and the first is the interesting one: the browser's client
   * takes a string, so what a repository actually writes is
   * `body: JSON.stringify(order)`, and the type worth recording is the one
   * inside the call rather than `string`. A client library takes the value
   * itself and needs no unwrapping.
   */
  const bodyOf = (
    call: CallExpression,
    client: RequestClient,
    shape: CallShape,
  ): { type: string | null; keys?: readonly string[] } => {
    // Handed to the receiver afterwards, `xhr.send(JSON.stringify(order))` (P294).
    if (shape.sentBy !== undefined) {
      const sent = sentBodyOf(call, shape.sentBy);
      if (sent === undefined) return { type: null };
      const sentKeys = writtenKeysOf([sent]);
      return { type: ctx.types.collectType(sent.getType(), sent), ...(sentKeys === undefined ? {} : { keys: sentKeys }) };
    }
    // Handed further along the chain, `request.post(url).send(order)` (P311).
    if (shape.chainedBody !== undefined) {
      const sent = chainedArgument(call, shape.chainedBody);
      if (sent === undefined) return { type: null };
      const sentKeys = writtenKeysOf([sent]);
      return { type: ctx.types.collectType(sent.getType(), sent), ...(sentKeys === undefined ? {} : { keys: sentKeys }) };
    }
    // The body under a key of the options, `ky.post(url, { json })` (P239).
    const keyed = shape.bodyKeys === undefined || shape.optionsAt === undefined
      ? undefined
      : shape.bodyKeys
          .map((bodyKey) => requestBodyOf(call, { ...PLATFORM_FETCH, optionsAt: shape.optionsAt as number, bodyKey }))
          .find((found) => found !== undefined);
    if (shape.bodyAt === undefined && keyed === undefined) return { type: null };
    const written =
      shape.bodyKeys !== undefined
        ? keyed
        : client.callee === undefined
          ? call.getArguments()[shape.bodyAt as number]
          : requestBodyOf(call);
    // `$.get(url, function (items) { … })`: a callback where the data may be.
    if (written === undefined || isWrittenFunction(written)) return { type: null };
    const keys = writtenKeysOf([written]);
    return {
      type: ctx.types.collectType(written.getType(), written),
      ...(keys === undefined ? {} : { keys }),
    };
  };

  /**
   * The query a call writes among its options (P256): the type of what it
   * hands under its shape's query option, and the keys where an object is
   * written there. `unread` where the options are handed by a name, which
   * may hold a query nothing here can see.
   */
  const queryOf = (call: CallExpression, shape: CallShape): { type?: string; keys?: readonly string[]; unread?: true; inAddress?: true } => {
    // A query built in code and written into the address: `` `/orders?${params}` `` (P258).
    const address = shape.urlKey === undefined ? call.getArguments()[shape.urlAt] : undefined;
    const inAddress = address === undefined ? undefined : builtQueryInAddress(address, QUERY_BUILDERS);
    const withAddress = (among: { type?: string; keys?: readonly string[]; unread?: true }): { type?: string; keys?: readonly string[]; unread?: true; inAddress?: true } => {
      if (inAddress === undefined) return among;
      if ('unread' in inAddress || among.unread === true) return { ...(among.type === undefined ? {} : { type: among.type }), unread: true };
      if (among.type !== undefined && among.keys === undefined) return among;
      return { ...(among.type === undefined ? {} : { type: among.type }), keys: [...new Set([...inAddress.keys, ...(among.keys ?? [])])].sort(), inAddress: true };
    };
    // Handed further along the chain, `request.get(url).query({ page })` (P317).
    if (shape.chainedQuery !== undefined) {
      const handed = chainedArgument(call, shape.chainedQuery);
      if (handed === undefined) return withAddress({});
      const keys = writtenKeysOf([handed]);
      return withAddress({ type: ctx.types.collectType(handed.getType(), handed), ...(keys === undefined ? {} : { keys }) });
    }
    if (shape.queryKeys === undefined || shape.optionsAt === undefined) return withAddress({});
    const argument = call.getArguments()[shape.optionsAt];
    if (argument === undefined) return withAddress({});
    const object = objectAt(call, shape.optionsAt);
    if (object === undefined) return withAddress({ unread: true });
    for (const key of shape.queryKeys) {
      const property = object.getProperty(key);
      const written = property === undefined ? undefined : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : valueOf(object, key);
      if (written === undefined) continue;
      const type = ctx.types.collectType(written.getType(), written);
      // `params: new URLSearchParams({ status })`, or a name holding one filled in by calls (P258).
      const built = builtQueryOf(written, QUERY_BUILDERS);
      if (built !== undefined) return withAddress('unread' in built ? { type, unread: true } : { type, keys: built.keys });
      const keys = writtenKeysOf([written]);
      return withAddress({ type, ...(keys === undefined ? {} : { keys }) });
    }
    return withAddress({});
  };

  /**
   * The names of the headers a call writes among its options (P258), with
   * the ones the instance it is made through writes for every request
   * (P262). `unread` where they are written and cannot be read, or where a
   * function that runs before the request - an instance's hook or
   * interceptor, the call's own hook - may add ones nothing here reads.
   */
  const headersOf = (call: CallExpression, shape: CallShape, runs: ClientInstance | undefined): { keys?: readonly string[]; unread?: true } => {
    const object = shape.optionsAt === undefined ? undefined : objectAt(call, shape.optionsAt);
    const property = object?.getProperty('headers');
    const written =
      property === undefined ? undefined : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
    // Headers may be in what is spread into the options, where none is written beside it.
    const spread = property === undefined && object?.getProperties().some((each) => Node.isSpreadAssignment(each)) === true;
    const own: readonly string[] | 'unread' | undefined =
      property !== undefined && written === undefined ? 'unread' : written === undefined ? (spread ? 'unread' : undefined) : (writtenHeaderNames(written, [PLATFORM_HEADERS]) ?? 'unread');
    const instance = runs?.headers;
    // What its hooks add once the options are merged (P265); a set written in place of the request's own replaces them.
    const hooks = runs?.hookHeaders;
    const replaced = hooks?.replaces === true;
    const keys = [...(Array.isArray(own) && !replaced ? own : []), ...(Array.isArray(instance) && !replaced ? instance : []), ...(hooks?.keys ?? [])];
    const unread = (!replaced && (own === 'unread' || instance === 'unread')) || hooks?.unread === true;
    if (own === undefined && instance === undefined && (hooks === undefined || hooks.keys.length === 0)) return unread ? { unread: true } : {};
    return { ...(keys.length === 0 && unread ? {} : { keys: [...new Set(keys)].sort() }), ...(unread ? { unread: true as const } : {}) };
  };

  /** The body a described client's call writes where its description says (P121). */
  const describedBodyOf = (described: DescribedRequest): { type: string | null; keys?: readonly string[] } => {
    const written = described.body;
    if (written === undefined) return { type: null };
    const keys = writtenKeysOf([written]);
    return { type: ctx.types.collectType(written.getType(), written), ...(keys === undefined ? {} : { keys }) };
  };

  /**
   * The base one call spells for itself, when it spells one.
   *
   * A client holds a base and nearly every call takes it; a call may write its
   * own — `client.post('/passkeys.register', body, { baseUrl: '/auth' })` — and
   * until this was read the request was recorded under the client's default and
   * landed at an address nothing serves. On a wiki app it is the last three browser
   * requests that do not join, and the route side of those three is already
   * right, so the two halves disagree by exactly the base the call overrides
   * (R114, R121, R128).
   *
   * Only an object written in place is read. An options argument that is a name
   * may hold a base and may not, and nothing here can tell: reporting every such
   * call would put a row on every request written with a shared config object,
   * and the row would say nothing anybody could act on. The case this refuses to
   * be quiet about is the one where the base *is* written here and could not be
   * read — there the default is the one answer known to be wrong, so the address
   * keeps what was read and a row names the line.
   */
  const baseWrittenAt = (
    call: CallExpression,
    shape: CallShape,
  ): { readonly kind: 'base'; readonly base: ApiUrl } | { readonly kind: 'unread'; readonly name: string } | null => {
    const object = objectAt(call, shape.optionsAt);
    if (object === undefined) return null;
    for (const name of BASE_FIELDS) {
      const written = valueOf(object, name);
      if (written === undefined) continue;
      const base = analyzeClientBase(written, { sharedPackages: ctx.config.sharedPackages });
      return isSomewhere(base) ? { kind: 'base', base } : { kind: 'unread', name };
    }
    return null;
  };

  /**
   * The instances of installed clients this repository makes, and their bases
   * (P239). The repository's own files are where a base is assigned after the
   * instance is made, `api.defaults.baseURL = …`, and they are searched once.
   */
  const repoDir = toPosixPath(ctx.repoDir).replace(/[/]+$/, '');
  let loaded: ReadonlySet<string> | undefined;
  // A client a page loads by a script tag is the global it leaves (P310).
  const pageLoaded = (): ReadonlySet<string> => {
    loaded ??= pageLoadedPackages(ctx.project.getFileSystem(), ctx.repoDir, CLIENT_FACTORIES.flatMap((factory) => (factory.pageGlobals === undefined ? [] : factory.modules)));
    return loaded;
  };
  // A global the linter's configuration declares, as the script's own comment does (P311).
  const declared = linterGlobals(ctx.project.getFileSystem(), ctx.repoDir);
  const instances = clientInstances({
    sharedPackages: ctx.config.sharedPackages,
    pageLoaded,
    declared,
    files: () =>
      ctx.project.getSourceFiles().filter((file) => {
        const path = toPosixPath(file.getFilePath());
        return path.startsWith(`${repoDir}/`) && !path.includes('/node_modules/');
      }),
  });

  /** The client a call through an instance is read as: the instance's own base on its client's row. */
  const clientOf = (instance: ClientInstance): RequestClient =>
    instance.base === undefined ? instance.factory.client : { ...instance.factory.client, base: instance.base };

  /**
   * A base an instance is made with that could not be read, or a function it
   * runs before every request whose rewrite of the address could not be
   * (P244), said once at the line that writes it.
   */
  const saidUnread = new Set<TsNode>();
  const reportUnreadBase = (instance: ClientInstance): void => {
    const say = (unread: { at: TsNode; why: string }, after: string): void => {
      if (saidUnread.has(unread.at)) return;
      saidUnread.add(unread.at);
      ctx.report({
        file: ctx.fileOf(unread.at),
        line: siteOf(unread.at).line,
        reason: 'api-client-base-unread',
        hint: `The base of this ${instance.factory.client.name} instance: ${unread.why}. ${after}`,
        symbol: unread.at.getText().slice(0, 80),
      });
    };
    if (instance.unread !== undefined) {
      say(
        instance.unread,
        'Requests through it are recorded under the path each call writes, and join by their route alone. Write the base as a literal, a settings key or a constant.',
      );
    }
    if (instance.rewriteUnread !== undefined) {
      say(
        instance.rewriteUnread,
        'Requests through it are recorded with an opening not read, `${…}` before the path each call writes, and join nothing. Set the base unconditionally or under a test of the address, to a literal, a settings key or a constant.',
      );
    }
  };

  /**
   * A hook a call writes among its own options whose rewrite of the address
   * could not be read (P250), said once at the line that writes it.
   */
  const reportUnreadCallHook = (hooked: ClientInstance): void => {
    const unread = hooked.rewriteUnread;
    if (unread === undefined || saidUnread.has(unread.at)) return;
    saidUnread.add(unread.at);
    ctx.report({
      file: ctx.fileOf(unread.at),
      line: siteOf(unread.at).line,
      reason: 'api-client-base-unread',
      hint: `The base of this ${hooked.factory.client.name} request: ${unread.why}. It is recorded with an opening not read, \`\${…}\` before the path the call writes, and joins nothing. Set the base unconditionally or under a test of the address, to a literal, a settings key or a constant.`,
      symbol: unread.at.getText().slice(0, 80),
    });
  };

  /**
   * Whether a client answers with the response itself, its headers on it
   * (P265): the platform's, axios's and ky's do; ofetch's answers with the
   * body, and its `.raw` with the response.
   */
  const answersWithResponse = (client: RequestClient, network: CallExpression): boolean => {
    if (client === FETCH || client === AXIOS || client === KY) return true;
    const callee = network.getExpression();
    return client === OFETCH && Node.isPropertyAccessExpression(callee) && callee.getName() === 'raw';
  };

  /** The operation a `fetch` in a helper sends, read from the document its caller hands it; reported where it cannot be read. */
  const handedOperation = (network: CallExpression, request: ReadRequest, site: RequestSite, line: number): Record<string, unknown> | undefined => {
    const query = fetchedQuery(network);
    if (query === undefined) return undefined;
    const handed = handedThrough(query, request.calls);
    if (handed === undefined) return undefined;
    const reading = documentOf(handed);
    if (reading.kind !== 'read') {
      ctx.report({
        file: site.file,
        line,
        reason: reading.kind === 'invalid' ? 'graphql-document-not-parsed' : 'graphql-document-dynamic',
        level: 'action',
        message: reading.why,
        hint: 'Hand the helper a document written as a gql template, a string or a .graphql file, so the fields it asks for can be joined.',
        symbol: request.through ?? network.getExpression().getText(),
      });
      return undefined;
    }
    const [operation] = operationsOf(reading.document, reading.fragments);
    return operation === undefined ? undefined : { ...operationMeta(operation, reading, (path) => normalizeFilePath(path, ctx.repoDir), 'fetch', undefined) };
  };

  const record = (found: FoundCall, request: ReadRequest, handedIn?: string | null): void => {
    // An instance of a class of the repository's own carries its base on its client, and runs what the class runs (P353).
    if (found.instance !== undefined && localInstances.has(found.instance)) {
      reportUnreadBase(found.instance);
      const { instance: _instance, ...rest } = found;
      record(rest, request, handedIn);
      return;
    }
    const { call: network, client, shape } = found;
    const { site } = request;
    if (found.instance !== undefined) reportUnreadBase(found.instance);
    // A hook the call writes for itself runs for this request alone (P250).
    const factory = found.instance?.factory ?? CLIENT_FACTORIES.find((each) => each.client.name === client.name);
    const hooked =
      factory === undefined || shape.optionsAt === undefined ? undefined : instances.atCall(network, factory, shape.optionsAt, found.instance);
    if (hooked !== undefined) reportUnreadCallHook(hooked);
    // The path at the call site is written under whatever base its client holds,
    // so the address is the two of them together. Recorded that way rather than
    // forgiven later: `impact`, `dead` and `contracts` all read what is written
    // here, and a recorded address missing a segment is wrong in the graph
    // whether or not the linker happens to forgive it (R114).
    //
    // Whose base: the call's own where it writes one, the client's otherwise,
    // and neither where the call writes one that could not be read — the
    // client's default is then the one answer already known to be wrong (R128).
    const written = baseWrittenAt(network, shape);
    const before =
      written === null ? client.base : written.kind === 'base' ? written.base : undefined;
    // And a function the instance runs before every request may rewrite
    // either, after both are known: it sets the base over the call's own, or
    // where none is set, or puts one in front of the address (P244).
    // A class of the project's own runs what the instance it writes through runs (P285).
    const runs = hooked ?? found.instance ?? client.runs;
    // A class's own base is written into the address its instance sees, under
    // the instance's own base (P293): the rewrite is put to the two together.
    const beneath = hooked === undefined && found.instance === undefined && written === null ? client.runs?.beneath : undefined;
    const seen = beneath === undefined ? request.address : underBase(before, request.address);
    const opening = beneath === undefined ? before : beneath.base;
    // Under a test of the address, only where the address it writes passes;
    // and a rewrite not read leaves the opening of the address a hole (P280).
    const applied = rewriteFor(runs, seen);
    const base = applied === 'unread' ? unreadOpening(opening) : basedBy(applied, opening);
    const rewritten = base !== opening;
    const address = underBase(base, seen);
    const at = siteOf(site.call);
    const leaf = makeLeafId('ui_api_call', ctx.repo, site.file, at.line, at.column);
    // One caller may reach a wrapper that writes several requests, so where the
    // request was followed out to a caller the id also carries where the
    // network is reached.
    const network_at = siteOf(network);
    const id = request.depth === 0 ? leaf : `${leaf}@${network_at.line}:${network_at.column}`;

    const verb =
      handedIn !== undefined ? handedIn : found.described !== undefined ? found.described.verb : verbOf(network, shape, request.calls);
    const sent = found.described === undefined ? bodyOf(network, client, shape) : describedBodyOf(found.described);
    // What a `GET` is handed as its data is its query, where the client writes it into the address (P317).
    const asQuery = found.described === undefined && verb !== null && shape.queryVerbs?.includes(verb) === true && sent.type !== null;
    const body: { type: string | null; keys?: readonly string[] } = asQuery ? { type: null } : sent;
    const query: { type?: string; keys?: readonly string[]; unread?: true; inAddress?: true } = asQuery
      ? withSentQuery(queryOf(network, shape), sent)
      : found.described === undefined
        ? queryOf(network, shape)
        : {};
    const headers = found.described === undefined ? headersOf(network, shape, hooked ?? found.instance) : {};
    // The headers the caller reads off the answer, where the request is made where it is read (P265).
    const answerHeaders = site.call === network && found.described === undefined && answersWithResponse(client, network) ? responseHeadersRead(network, 'promise') : undefined;
    const application = applicationOfFile(ctx.meta, site.file);
    // A GraphQL operation a helper of the repository's posts, with the
    // document its caller hands it (P266): read where the caller writes it.
    const operation = client === FETCH && request.depth > 0 ? handedOperation(network, request, site, at.line) : undefined;

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${verb ?? '?'} ${address.path ?? address.url ?? '?'}`,
      repo: ctx.repo,
      file: site.file,
      line: at.line,
      kind: 'http',
      meta: {
        method: verb,
        url: address.url,
        path: address.path,
        baseUrlEnv: address.baseUrlEnv,
        ...(address.baseUrlEnv === null || address.baseUrlDefault === undefined ? {} : { baseUrlDefault: address.baseUrlDefault }),
        ...defaultFromOf(address, site.file),
        ...(address.baseUrlEnv === null || address.baseUrlAlso === undefined ? {} : { baseUrlAlso: address.baseUrlAlso }),
        ...(address.baseUrlEnv === null || address.baseUrlEither === undefined ? {} : { baseUrlEither: address.baseUrlEither }),
        ...(address.baseUrlEnv === null || address.baseUrlAlsoTiers === undefined ? {} : { baseUrlAlsoTiers: address.baseUrlAlsoTiers }),
        responseType: typeOfResponse(network),
        bodyType: body.type,
        ...(body.type === null ? {} : { bodyFrom: 'literal' }),
        ...(body.keys === undefined ? {} : { bodyKeys: body.keys }),
        ...(query.type === undefined ? {} : { queryType: query.type }),
        ...(query.keys === undefined ? {} : { queryKeys: query.keys }),
        ...(query.unread === true ? { queryUnread: true } : {}),
        // Its keys include those of a query built into the address, which the address shows as `${…}` (P258).
        ...(query.inAddress === true ? { queryInAddress: true } : {}),
        // The headers it writes, for a procedure whose input takes them (P258),
        // and whether more may be added that are not read (P262).
        ...(headers.keys === undefined ? {} : { headerKeys: headers.keys }),
        ...(headers.unread === true ? { headersUnread: true } : {}),
        // The headers it reads off the answer, for a procedure whose output declares them (P265).
        ...(answerHeaders === undefined || answerHeaders.keys.length === 0 ? {} : { responseHeaderKeys: answerHeaders.keys }),
        ...(answerHeaders?.unread === true ? { responseHeadersUnread: true } : {}),
        package: client.package,
        client: client.name,
        // Which application this request is written in, where the service holds
        // more than one. The other half of an address: an entry records the
        // application that serves it, and until a call site recorded its own a
        // tie between two applications could not be resolved even for a caller
        // sitting inside one of them (R132). Asked of the file, through the one
        // function that decides whether an id carries an application at all.
        ...(application === undefined ? {} : { application }),
        // Where the opening of the address came from, said only when it is not
        // the client's own: an address that differs from every other one this
        // client writes is a fact a reader should not have to go and work out.
        ...(rewritten
          ? { baseFrom: hooked?.rewrite !== undefined && hooked.rewrite !== found.instance?.rewrite ? 'call-hook' : 'interceptor' }
          : written?.kind === 'base'
            ? { baseFrom: 'call' }
            : {}),
        ...(found.local === undefined ? {} : { localClient: found.local }),
        via: address.via,
        ...(found.described?.client.describedBy === undefined ? {} : { describedBy: found.described.client.describedBy }),
        ...(address.host === null ? {} : { host: address.host }),
        // A number glued to the host, `localhost4600`: the linker joins no
        // route by the path of a host that cannot be meant (P330).
        ...(address.portWithoutColon === undefined ? {} : { portWithoutColon: { number: address.portWithoutColon.number, host: address.portWithoutColon.host } }),
        ...(address.guessed ? { guessed: true } : {}),
        ...(request.through === undefined ? {} : { through: request.through }),
        ...(operation === undefined ? {} : { [GRAPHQL_META]: operation }),
      },
    });
    ctx.builder.addEdge({
      from: site.ownerId,
      to: id,
      type: 'calls',
      confidence: address.path === null || verb === null || found.described?.evidence === 'stated' ? 'heuristic' : 'static',
      file: site.file,
      line: at.line,
    });

    if (address.host !== null) {
      const apiId = makeExternalApiId(address.host);
      ctx.builder.addNode({
        id: apiId,
        type: 'external_api',
        label: address.host,
        repo: ctx.repo,
        meta: { host: address.host },
      });
      ctx.builder.addEdge({
        from: id,
        to: apiId,
        type: 'calls',
        confidence: 'static',
        file: site.file,
        line: at.line,
      });
    }

    if (address.path === null) {
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-path-dynamic',
        hint: 'The address is built at run time. Annotate the function with /** @flowatlas-calls METHOD /path */.',
        symbol: network.getText().slice(0, 80),
      });
    } else if (address.host !== null && (address.path === UNREAD_SPAN || address.path.startsWith(`/${UNREAD_SPAN}`))) {
      // `'https://shop.example' + path` where no caller hands the path in a
      // form that is read (P308): the host is known and the path is not,
      // which is no request to the host's root; nor is a path opened by a
      // value that is no port, `https://shop.example${x}/orders` (P312).
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-path-dynamic',
        message: `The path after ${address.host} is a value nothing here reads, and no caller hands it one that is read.`,
        hint: 'Call the function with the path written out, or annotate it with /** @flowatlas-calls METHOD /path */.',
        symbol: network.getText().slice(0, 80),
      });
    }
    if (address.portWithoutColon !== undefined) ctx.report(portWithoutColonRow(address.portWithoutColon, site.file, at.line, network.getText()));
    if (written?.kind === 'unread') {
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-base-override-unread',
        hint: `The call writes ${written.name} of its own and it could not be read, so the address is recorded as the path alone rather than under the client's default, which this call says is not the base. Write the base as a literal or a constant.`,
        symbol: network.getText().slice(0, 80),
      });
    }
    if (verb === null) {
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-method-dynamic',
        hint: 'The verb comes from an options object assembled elsewhere. Annotate the function with /** @flowatlas-calls METHOD /path */.',
        symbol: network.getText().slice(0, 80),
      });
    }
    if (
      address.baseUrlEnv !== null &&
      apiBaseEnv.length > 0 &&
      !apiBaseEnv.includes(address.baseUrlEnv)
    ) {
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-base-unknown',
        hint: `Add ${address.baseUrlEnv} to services[].apiBaseEnv, and services[].apiTarget to say which service answers it.`,
        symbol: network.getText().slice(0, 80),
      });
    }
  };

  /**
   * Requests written with a client this reader knows without being told.
   *
   * Kept apart from the whole of {@link callsIn} for one reason: it is also how
   * a class of this repository's own is asked whether it reaches the network, and
   * that question has to be answerable without the answer depending on itself.
   */
  const describedCallsIn = (body: TsNode, leaveOut?: ReadonlySet<TsNode>): FoundCall[] => {
    const found: FoundCall[] = [];
    forEachCall(body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();

      if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        // A client's browser global called with no import, `ky(url)`, is the
        // client's only where the page has it, as `ky.get(url)` is (P334):
        // read below through what declares it, else said undeclared.
        const pageGlobal = PAGE_GLOBAL_NAMES.has(name) && isBarePageGlobal(callee);
        for (const client of REQUEST_CLIENTS) {
          const shape = client.callee;
          if (pageGlobal || shape === undefined || !shape.names.includes(name)) continue;
          if (!isPlatformProvided(callee)) continue;
          found.push({ call: node, client, shape });
          return;
        }
        // An instance called as a function, `api('/orders', { method: 'POST' })`
        // (P239), or handed one options object holding the address,
        // `api({ url: '/orders', method: 'post' })` (P244); the module itself
        // is called the same two ways.
        const instance = instances.of(callee);
        if (instance === undefined) return;
        const written = node.getArguments()[0];
        const shape = written !== undefined && Node.isObjectLiteralExpression(written) ? instance.factory.configCalled : instance.factory.called;
        if (written === undefined || shape === undefined) return;
        found.push({ call: node, client: clientOf(instance), shape, instance });
        return;
      }

      if (!Node.isPropertyAccessExpression(callee)) return;
      const method = callee.getName().toLowerCase();
      const receiver = callee.getExpression();
      const origin = resolveTypeOrigin(receiver);
      for (const client of REQUEST_CLIENTS) {
        const shape = Object.hasOwn(client.receiver?.verbs ?? {}, method) ? client.receiver?.verbs[method] : undefined;
        if (shape === undefined || !isClientValue(origin, client)) continue;
        // Known by its type; its base is the instance's, where it can be
        // followed to where it is made (P239).
        const instance = instances.of(receiver);
        if (instance !== undefined && instance.factory.client === client) {
          found.push({ call: node, client: clientOf(instance), shape, instance });
          return;
        }
        // A field or a parameter its type names, `constructor(private api:
        // AxiosInstance)`: the instances it is handed, where every value is
        // one (P330), each the request's at the caller that hands it as an
        // untyped one's are; the type alone, with no base, where not.
        const handed = typedHeldAt(receiver, client);
        const agreed = handed === undefined ? undefined : agreedInstance(handed.map((each) => each.instance));
        if (agreed !== undefined) found.push({ call: node, client: clientOf(agreed), shape, instance: agreed });
        else found.push({ call: node, client, shape, ...(handed === undefined ? {} : { held: handed }) });
        return;
      }
      // Known by how it was made, where its type is not known: the package's
      // own import, followed to the instance it makes (P239). Asked only of a
      // name some instance answers to, since every member call passes here.
      const instance = INSTANCE_VERBS.has(method) ? instances.of(receiver) : undefined;
      if (instance !== undefined) {
        const verbs = instance.factory.verbs;
        const shape = Object.hasOwn(verbs, method) ? verbs[method] : undefined;
        if (shape !== undefined) found.push({ call: node, client: clientOf(instance), shape, instance });
        return;
      }
      // Known by what it is handed, where neither says (P301).
      const held = heldCallAt(node, receiver, method);
      if (held !== undefined) found.push(held);
    }, leaveOut);
    // `$.ajax({ url, type })` is the settings spelling of `$.ajax(url, { type })` (P311).
    return found.map((each) => {
      const shape = settledShape(each.call, each.shape);
      return shape === each.shape ? each : { ...each, shape };
    });
  };

  /** The clients whose values are known by their type and answer to a method. */
  const typedClientsOf = (method: string): RequestClient[] => REQUEST_CLIENTS.filter((client) => Object.hasOwn(client.receiver?.verbs ?? {}, method));

  /** Whether the compiler says nothing of what a node is. */
  const untyped = (node: TsNode): boolean => {
    const type = node.getType();
    return type.isAny() || type.isUnknown();
  };

  /** A value that is no value: a field declared `null` before it is filled in. */
  const holdsNothing = (value: TsNode): boolean => Node.isNullLiteral(value) || (Node.isIdentifier(value) && value.getText() === 'undefined');

  /** What a receiver may hold, followed to where it is given each value (P301). */
  const heldBy = receiverValues((value) => {
    if (instances.of(value) !== undefined || localClassOf(value) !== undefined) return true;
    const origin = resolveTypeOrigin(value);
    return REQUEST_CLIENTS.some((client) => isClientValue(origin, client));
  });

  /**
   * What a receiver may hold, followed past values the compiler knows by
   * their type to the instances they are (P330): `this.api` typed
   * `AxiosInstance` is a value of that client, and what tells its base is the
   * instance each `new` hands the constructor.
   */
  const instancesBy = receiverValues((value) => instances.of(value) !== undefined);

  /**
   * The instances a receiver its type names a client holds (P330), each said
   * to be handed where it is given: where every value it may hold is an
   * instance of that client, and at least one is. Nothing otherwise - a
   * parameter nobody hands anything, a value read from somewhere this does
   * not follow - and the type alone is what is read.
   */
  const typedHeldAt = (receiver: TsNode, client: RequestClient): NonNullable<FoundCall['held']> | undefined => {
    const handed: { instance: ClientInstance; at: TsNode }[] = [];
    for (const value of instancesBy(receiver)) {
      if (holdsNothing(value)) continue;
      const instance = instances.of(value);
      if (instance === undefined || instance.factory.client !== client) return undefined;
      handed.push({ instance, at: value });
    }
    return handed.length > 0 ? handed : undefined;
  };

  /**
   * A request made on a receiver the compiler knows nothing of (P301): a
   * parameter with no type, a field declared `null` and filled in later or
   * handed to the constructor. Read as a request where every value it may
   * hold that is known for anything is a value of one client - the
   * platform's `XMLHttpRequest`, or an instance of an installed client - and
   * at least one is. Values nothing knows (a parameter nobody hands anything)
   * are passed over; one known for something else makes it no request.
   * Instances made with different bases are each the request's at the caller
   * that hands it (P312), see {@link recordHeld}.
   */
  const heldCallAt = (node: CallExpression, receiver: TsNode, method: string): FoundCall | undefined => {
    const typed = typedClientsOf(method);
    if ((typed.length === 0 && !INSTANCE_VERBS.has(method)) || !untyped(receiver)) return undefined;
    const clients = new Set<RequestClient>();
    const held = new Set<ClientInstance>();
    const handed: { instance: ClientInstance; at: TsNode }[] = [];
    const spreads: TsNode[] = [];
    for (const value of heldBy(receiver)) {
      if (holdsNothing(value)) continue;
      // A prop an element hands through a spread not read (P349): passed over as a value nothing knows, and said.
      if (Node.isJsxSpreadAttribute(value)) {
        spreads.push(value);
        continue;
      }
      const instance = instances.of(value);
      if (instance !== undefined) {
        held.add(instance);
        handed.push({ instance, at: value });
        continue;
      }
      const client = typed.find((each) => isClientValue(resolveTypeOrigin(value), each));
      if (client !== undefined) clients.add(client);
      else if (!untyped(value)) return undefined;
    }
    if (clients.size + (held.size > 0 ? 1 : 0) !== 1) return undefined;
    const [client] = clients;
    if (client !== undefined) {
      const shape = client.receiver?.verbs[method];
      if (shape === undefined) return undefined;
      reportSpreadsUnread(node, client, spreads);
      return { call: node, client, shape };
    }
    const [first] = held;
    if (first === undefined || [...held].some((each) => each.factory !== first.factory)) return undefined;
    const shape = Object.hasOwn(first.factory.verbs, method) ? first.factory.verbs[method] : undefined;
    if (shape === undefined) return undefined;
    reportSpreadsUnread(node, first.factory.client, spreads);
    const agreed = agreedInstance([...held]);
    return agreed !== undefined ? { call: node, client: clientOf(agreed), shape, instance: agreed } : { call: node, client: first.factory.client, shape, held: handed };
  };

  /** The spreads already said at each request, so a request read twice says each once. */
  const spreadsSaid = new Set<string>();

  /**
   * A request whose receiver is a prop some element hands through a spread
   * not read (P349): `<Feed {...props} />` where nothing says what `props`
   * holds. The request is read from what the other elements hand by name;
   * what the spread hands, and its base, is not read, which is said once
   * per spread at the request.
   */
  const reportSpreadsUnread = (node: CallExpression, client: RequestClient, spreads: readonly TsNode[]): void => {
    const at = siteOf(node);
    for (const spread of spreads) {
      const where = siteOf(spread);
      const key = `${ctx.fileOf(node)}:${at.line}:${ctx.fileOf(spread)}:${where.line}:${spread.getStart()}`;
      if (spreadsSaid.has(key)) continue;
      spreadsSaid.add(key);
      ctx.report({
        file: ctx.fileOf(node),
        line: at.line,
        reason: 'api-client-base-unread',
        hint:
          `The receiver is a prop that ${spread.getText().slice(0, 60)} at ${ctx.fileOf(spread)}:${where.line} may hand, and what it spreads could not be followed, ` +
          `so the ${client.name} instance it hands, and its base, are not read; the request is read from the instances handed by name. ` +
          'Hand the prop by name, or spread an object or props this reader can follow.',
        symbol: node.getText().slice(0, 80),
        meta: { spread: { file: ctx.fileOf(spread), line: where.line } },
      });
    }
  };

  /** The one instance several stand for, where they are one or are made with one base and nothing rewrites it. */
  const agreedInstance = (held: readonly ClientInstance[]): ClientInstance | undefined => {
    const [first] = held;
    if (first === undefined) return undefined;
    const same = (each: ClientInstance): boolean =>
      each === first || (each.factory === first.factory && each.rewrite === undefined && each.rewriteUnread === undefined && first.rewrite === undefined && first.rewriteUnread === undefined && JSON.stringify(each.base ?? null) === JSON.stringify(first.base ?? null));
    return held.every(same) ? first : undefined;
  };

  /**
   * A request on a receiver handed instances made with different bases
   * (P312): one per caller that hands them, attributed to it and carrying
   * the base of what it hands, as an address handed in is read at each
   * caller. What is handed outside any function, or in the function the
   * request is written in, stays with the request where it is written,
   * under its base where those agree and the path alone where they do not,
   * which is said.
   */
  const recordHeld = (found: FoundCall, request: ReadRequest, through: string, held: FoundCall['held'] = found.held): void => {
    const groups = new Map<string, { owner: IndexedFunction | undefined; at: TsNode; instances: ClientInstance[] }>();
    for (const { instance, at } of held ?? []) {
      const caller = enclosingIndexed(ctx, at, isClientClass);
      const owner = caller === undefined || caller.id === request.site.ownerId ? undefined : caller;
      const key = owner?.id ?? '';
      const group = groups.get(key) ?? { owner, at, instances: [] };
      group.instances.push(instance);
      groups.set(key, group);
    }
    for (const { owner, at, instances: group } of groups.values()) {
      const agreed = agreedInstance(group);
      const { held: _held, ...rest } = found;
      const one: FoundCall = agreed === undefined ? rest : { ...rest, client: clientOf(agreed), instance: agreed };
      if (owner === undefined) {
        if (agreed === undefined) reportBasesDisagree(found, group);
        record(one, request);
        continue;
      }
      // Instances that disagree handed by one caller, the top of a script
      // among them (P334): that caller carries none of their bases alone.
      if (agreed === undefined) reportBasesDisagree(found, group, `in ${owner.name}, which carries none of their bases alone`);
      ensureOwner(ctx, owner.id);
      const handing = at.getFirstAncestor((node) => Node.isCallExpression(node) || Node.isNewExpression(node)) ?? at;
      record(one, { ...request, site: { call: handing, ownerId: owner.id, file: owner.file }, depth: request.depth + 1, through, calls: request.calls });
    }
  };

  /**
   * A request on a receiver handed instances made with different bases
   * whose address is itself followed out to a caller (P318): the instances
   * that caller hands - what the receiver is handed along the calls the
   * address came out through - each under its own base, as at the request
   * where it is written (see {@link recordHeld}); one a caller further out
   * hands is that caller's. The receiver may be a parameter, a field of the
   * instance the call is made on or a member of an object handed in, each
   * followed to what gave it (P324); one in a method of its own class whose
   * address is followed out through calls on `this` is read at each caller
   * of that method. Where none of these says, nothing tells which of the
   * instances is this caller's: the path alone, which is said.
   */
  const recordHeldAlong = (found: FoundCall, request: ReadRequest): void => {
    const callee = found.call.getExpression();
    // A parameter, a field of the instance the call is made on, a member of
    // an object handed in: what each is handed along these calls (P324).
    const handed = Node.isPropertyAccessExpression(callee) ? valuesAlong(callee.getExpression(), request.calls) : undefined;
    const along = (handed ?? []).flatMap((each) => instancesHeld(each));
    const said: { framework?: string } = {};
    const held = along.length > 0 ? along : (heldAtCallers(found, request, said) ?? []);
    if (held.length > 0) {
      recordHeld(found, request, request.through ?? '', held);
      return;
    }
    const { held: all, ...rest } = found;
    const where = said.framework === undefined ? 'along the callers its address is read at' : `in a method ${said.framework} calls, on an instance no code read hands it`;
    reportBasesDisagree(found, (all ?? []).map((each) => each.instance), where);
    record(rest, request);
  };

  /** The client instances a value may hold, each said to be handed at `at`, or where it is made. */
  const instancesHeld = (value: TsNode, at?: TsNode): NonNullable<FoundCall['held']> =>
    instancesBy(value).flatMap((each) => {
      const instance = holdsNothing(each) ? undefined : (instances.of(each) ?? localInstanceOf(each));
      return instance === undefined ? [] : [{ instance, at: at ?? each }];
    });

  /**
   * The instances a receiver holds, read out past the calls the address came
   * out through to the outermost caller that gives each (P324, P330): a field
   * of `this` at each caller of the method the request is written in or
   * followed out to - `health() { return this.read('/health'); }` called as
   * `new Reader(stockApi).health()` holds `stockApi` in `this.api` there,
   * whatever other instances are made - and, where that caller calls it on
   * an instance it was itself handed, a parameter or a field of its own
   * `this`, on out to whoever hands that one, so `check(new Reader(stockApi))`
   * carries the base of `stockApi`. Each is said to be handed at the
   * outermost caller followed. Nothing where a step has no caller or reads a
   * value it cannot follow (see {@link placedOut}).
   */
  const heldAtCallers = (found: FoundCall, request: ReadRequest, said?: { framework?: string }): FoundCall['held'] | undefined => {
    const callee = found.call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    // A method no code read calls, that a framework does on an instance no code read hands it, is said (P336).
    const stopped: { framework?: string } = {};
    const placed = placedOut(callee.getExpression(), request.calls, stopped);
    if (placed === undefined) {
      if (said !== undefined && stopped.framework !== undefined) said.framework = stopped.framework;
      return undefined;
    }
    const held: NonNullable<FoundCall['held']>[number][] = [];
    for (const { value, at } of placed) {
      if (holdsNothing(value)) continue;
      const each = instancesHeld(value, at);
      // A caller handing a value no instance is read from: which base is its is not told.
      if (each.length === 0) return undefined;
      held.push(...each);
    }
    return held.length > 0 ? held : undefined;
  };

  /**
   * A request on instances with different bases in a method a framework
   * calls (P336), on an instance it holds that no code read hands it - one it
   * makes itself, through its injector or its renderer: which base is the
   * request's is not told, so it is placed at each function that makes an
   * instance (P312), which is said once at the request.
   */
  const reportFrameworkHeld = (found: FoundCall, framework: string): void => {
    const at = siteOf(found.call);
    ctx.report({
      file: ctx.fileOf(found.call),
      line: at.line,
      reason: 'api-client-base-unread',
      hint: `The receiver is handed ${found.client.name} instances made with different bases, and the method the request is made in is called by ${framework}, on an instance no code read hands it, so the request is placed at each function that makes an instance. Register the instance where the code makes it, or write one base.`,
      symbol: found.call.getText().slice(0, 80),
    });
  };

  /** Instances with different bases handed where no one caller can carry each, said once at the request. */
  const reportBasesDisagree = (found: FoundCall, held: readonly ClientInstance[], where = 'outside any function that could carry each'): void => {
    const at = siteOf(found.call);
    ctx.report({
      file: ctx.fileOf(found.call),
      line: at.line,
      reason: 'api-client-base-unread',
      hint: `The receiver is handed ${held.length} ${found.client.name} instances made with different bases ${where}, so the request is recorded under the path it writes. Hand each instance from a function of its own, or write one base.`,
      symbol: found.call.getText().slice(0, 80),
    });
  };

  /**
   * What each class of this repository turned out to be, asked once.
   *
   * One class carries every request in an application — that is what makes it
   * worth reading — so the same declaration is reached from a hundred call sites,
   * and the walk over its members is the expensive part of this pass.
   */
  const readings = new Map<ClassDeclaration, LocalClientReading>();
  /** The instances a value may hold: each `new` it is given (P353). */
  const madeBy = receiverValues((value) => Node.isNewExpression(value));
  const classReading: Pick<ClassReading, 'writesOutside' | 'instancesOn' | 'address'> = {
    address: (node) => analyzeClientBase(node, { sharedPackages: ctx.config.sharedPackages }),
    // Each write of a base outside the class, and the instances the value it is made on may hold (P353).
    writesOutside: (owner, field) => fieldWritesOutside(owner, field),
    instancesOn: (on) => {
      const made = madeBy(on);
      return made.length > 0 && made.every((each) => Node.isNewExpression(each)) ? made : undefined;
    },
  };
  const readingOf = (cls: ClassDeclaration): LocalClientReading => {
    if (readings.has(cls)) return readings.get(cls);
    const reading = localClientOf(cls, {
      ...classReading,
      reaches: (body) => describedCallsIn(body).length > 0,
      declared: ctx.config.adapters.frontend.localClientClasses,
      // A base written on the class's instances from outside it (P349).
      writtenOutside: (owner, field) => fieldWrittenOutside(owner, field),
      baseUnread: (owner, field, why) => {
        const at = siteOf(owner);
        ctx.report({
          file: ctx.fileOf(owner),
          line: at.line,
          reason: 'api-client-base-unread',
          hint: `The base ${owner.getName() ?? 'the class'} keeps in its field ${field} ${why}, so its requests are recorded under the paths they write. Give the field one base, in the class or on each instance alike.`,
          symbol: `${owner.getName() ?? 'class'}.${field}`,
        });
      },
      // The base of each instance the class's members write through, and the
      // one that could not be read said where it is made (P239).
      basesIn: (body) =>
        describedCallsIn(body).map((found) => {
          if (found.instance !== undefined) reportUnreadBase(found.instance);
          if (found.instance === undefined) return null;
          // A rewrite under a test of each request's address is no one base of
          // the instance (P280): the class carries it, and it is applied to the
          // address each call of the class writes (P285), as is one not read.
          const { rewrite, rewriteUnread } = found.instance;
          if (rewriteUnread !== undefined) return { base: found.instance.base, runs: { rewriteUnread } };
          if (rewrite?.test !== undefined) return { base: found.instance.base, runs: { rewrite } };
          return { base: basedBy(rewrite, found.instance.base) };
        }),
    });
    readings.set(cls, reading);
    return reading;
  };

  /** The instances of classes of the repository's own whose instances are each given their own base (P353). */
  const localInstances = new WeakSet<ClientInstance>();
  const localMade = new Map<TsNode, ClientInstance | undefined>();
  const localFactories = new Map<ClassDeclaration, ClientFactory>();

  /**
   * The instance a `new` of a class of the repository's own makes, where the
   * class's instances are each given their own base outside it (P353): read
   * as an installed client's instance is, with the base the writes made on it
   * give it, so a request through it is under that base and one through
   * instances given different bases is each caller's that hands one. Only a
   * class already read is asked, so reading a class never asks it again.
   */
  const localInstanceOf = (value: TsNode): ClientInstance | undefined => {
    if (!Node.isNewExpression(value)) return undefined;
    if (localMade.has(value)) return localMade.get(value);
    const cls = localClassOf(value);
    const reading = cls === undefined ? undefined : readings.get(cls);
    if (cls === undefined || reading?.kind !== 'client' || reading.instanceBases === undefined) return undefined;
    let factory = localFactories.get(cls);
    if (factory === undefined) {
      factory = { client: reading.client, modules: [], methods: [], baseKey: reading.instanceBases.field, verbs: reading.client.receiver?.verbs ?? {} };
      localFactories.set(cls, factory);
    }
    const { base, unread } = instanceBaseOf(reading.instanceBases, value, classReading);
    const instance: ClientInstance = { factory, ...(base === undefined ? {} : { base }), ...(unread === undefined ? {} : { unread: { at: value, why: unread } }) };
    localInstances.add(instance);
    localMade.set(value, instance);
    return instance;
  };

  /**
   * A request through a class whose instances are each given their own base
   * outside it (P353): under the base of the instance the receiver holds,
   * where every value it may hold is one and they agree; one per caller
   * handing each where they do not, as an installed client's instances are
   * (P312); the path alone where a value it may hold is not read, which is
   * said.
   */
  const localInstanceCall = (found: FoundCall, receiver: TsNode, name: string): FoundCall => {
    const handed: { instance: ClientInstance; at: TsNode }[] = [];
    let unknown = false;
    for (const value of madeBy(receiver)) {
      if (holdsNothing(value)) continue;
      const instance = localInstanceOf(value);
      if (instance === undefined) unknown = true;
      else handed.push({ instance, at: value });
    }
    if (unknown || handed.length === 0) {
      const at = siteOf(found.call);
      ctx.report({
        file: ctx.fileOf(found.call),
        line: at.line,
        reason: 'api-client-base-unread',
        hint: `${name}'s instances are each given their own base outside the class, and which instance this receiver holds could not be followed to where it is made, so the request is recorded under the path it writes. Hand the receiver an instance made where this reader can follow it, or give the class one base.`,
        symbol: found.call.getText().slice(0, 80),
      });
      return found;
    }
    const agreed = agreedInstance(handed.map((each) => each.instance));
    if (agreed !== undefined) {
      reportUnreadBase(agreed);
      return { ...found, client: clientOf(agreed) };
    }
    return { ...found, held: handed };
  };

  /** A class read as a client of the repository's own: its methods are no caller a request is followed out through (P293). */
  const isClientClass = (cls: ClassDeclaration): boolean => readingOf(cls)?.kind === 'client';

  /**
   * Whether a call whose receiver is unread writes an address all the same.
   *
   * This is what keeps the row about an unrecognised client from being a row
   * about every class with a `get`, and it is a reading rather than a guess at
   * names. A store called as `documents.get(id)` is handed an identifier, and
   * nothing about it is a request; a client called as `api.post('/documents.info')`
   * is handed a path, written in full, at the call site. Measured on a wiki app, the
   * question is worth asking: two hundred and twenty sites answer the verb test,
   * and one of them writes an address.
   *
   * Read in full, and rooted — a leading slash, or a host of its own. Both halves
   * were earned: `documents.get("mock-document-id")` reads as an address once a
   * path is normalised, and it is a store being handed an identifier. It is asked
   * with the same reader that settles the address when the class *is* recognised,
   * so the two cannot disagree about what an address is. A site whose address
   * could not be read is left silent on purpose: naming its client would buy a
   * row saying the address is built at run time, which is no further forward.
   */
  const writesAddress = (node: CallExpression): boolean => {
    const written = node.getArguments()[0];
    if (written === undefined) return false;
    const address = analyzeApiUrl(written, { sharedPackages: ctx.config.sharedPackages });
    if (address.path === null || !wasRead(address.path)) return false;
    // Rooted: at a host, at a settings key, or at the server the page came from.
    return (
      address.host !== null ||
      address.baseUrlEnv !== null ||
      address.url?.startsWith('/') === true
    );
  };

  /** The class of this repository a receiver's type is, when it is one. */
  const localClassOf = (receiver: TsNode): ClassDeclaration | undefined => {
    const origin = resolveTypeOrigin(receiver);
    if (origin === null || !origin.isLocal || origin.package !== null) return undefined;
    const declaration = origin.declaration;
    return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
  };

  /**
   * The class of this repository a receiver the compiler knows nothing of
   * holds (P301): `this.api.get(...)` where the constructor is handed
   * `new ApiClient()`. The one class every value known for anything is an
   * instance of; none where a value is known for something else.
   */
  const heldClassOf = (receiver: TsNode): ClassDeclaration | undefined => {
    if (!untyped(receiver)) return undefined;
    const classes = new Set<ClassDeclaration>();
    for (const value of heldBy(receiver)) {
      const cls = localClassOf(value);
      if (cls !== undefined) classes.add(cls);
      else if (!holdsNothing(value) && !untyped(value)) return undefined;
    }
    const [only] = classes;
    return classes.size === 1 ? only : undefined;
  };

  /**
   * A verb called on a class this repository wrote, when that is what it is.
   *
   * The two installed clients are asked first, so nothing here can change what
   * was already read; this only ever answers for a receiver they all declined.
   * Where the class is a client the call is read as one, and where it is only
   * spelled like one the site says so — which is the half of R87 that is not
   * optional whichever way the other half is decided.
   */
  const localCallAt = (node: CallExpression, callee: TsNode, verb: string): FoundCall | undefined => {
    if (!Object.hasOwn(VERB_CALLS, verb)) return undefined;
    const cls = localClassOf(callee) ?? heldClassOf(callee);
    if (cls === undefined) return undefined;
    const reading = readingOf(cls);
    if (reading === undefined) return undefined;
    if (reading.kind === 'unread') {
      if (!writesAddress(node)) return undefined;
      const at = siteOf(node);
      ctx.report({
        file: ctx.fileOf(node),
        line: at.line,
        reason: 'api-client-unread',
        hint:
          `${reading.typeName} declares ${verb} and this reader could not follow it to a request. ` +
          `Add ${JSON.stringify(reading.typeName)} to adapters.frontend.localClientClasses in ` +
          'flowatlas.config.json if it is a client of your own; nothing is needed if it is not.',
        symbol: node.getText().slice(0, 80),
      });
      return undefined;
    }
    const shape = Object.hasOwn(reading.client.receiver?.verbs ?? {}, verb) ? reading.client.receiver?.verbs[verb] : undefined;
    if (shape === undefined) return undefined;
    const found: FoundCall = { call: node, client: reading.client, shape, local: reading.via };
    // Instances each given their own base outside the class: the instance's (P353).
    return reading.instanceBases === undefined ? found : localInstanceCall(found, callee, cls.getName() ?? 'The class');
  };

  /**
   * A call of a client the configuration describes, when it is one (P121):
   * asked after the clients this reader knows, which win and leave a pattern
   * on the same call shadowed, and before a class of the repository is asked
   * whether it is a client, because the description is the project saying so.
   */
  const { clients } = ctx.config.adapters.http;
  const describedAt = (node: CallExpression, builtIn: boolean): FoundCall | undefined => {
    if (clients.length === 0) return undefined;
    const matches = describedRequestsAt(node, clients);
    if (matches.length === 0) return undefined;
    const at = { file: ctx.fileOf(node), line: siteOf(node).line, symbol: node.getExpression().getText().slice(0, 60) };
    const choice = builtIn
      ? { chosen: [], shadowed: [...new Set(matches.flatMap((match) => match.client.describedBy ?? []))], ambiguous: [] }
      : precedenceOf(matches, (match) => match.client.describedBy);
    for (const row of precedenceRows(choice, at, builtIn ? 'the built-in reading of the request' : 'a client described under adapters.http.clients')) {
      ctx.report(row);
    }
    const chosen = choice.chosen[0];
    if (chosen === undefined) return undefined;
    return {
      call: node,
      client: { name: chosen.client.describedBy ?? 'described', package: null },
      shape: { method: chosen.verb, urlAt: -1 },
      described: chosen,
    };
  };

  /**
   * A call of a client's browser global nothing says the page has (P323):
   * `axios.get(url)`, `ky.post(url)` or `unfetch(url)` with no import, no script tag, no `/*
   * global *\/` comment and no linter global. It is no request this reader
   * can stand behind - the name may be anything the page is given - so it is
   * not read as one, and a row says why rather than nothing.
   */
  const saidUndeclared = new Set<TsNode>();
  const sayUndeclaredGlobal = (node: CallExpression): void => {
    if (saidUndeclared.has(node)) return;
    const callee = node.getExpression();
    const holder = Node.isIdentifier(callee) ? callee : Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
    if (holder === undefined || !Node.isIdentifier(holder)) return;
    // A request's spelling on a client's global by its name, or on a wrapper's
    // parameter it may be handed as - called on, or called itself (P334).
    if (Node.isPropertyAccessExpression(callee) && !PAGE_GLOBAL_VERBS.has(callee.getName().toLowerCase())) return;
    if (!PAGE_GLOBAL_NAMES.has(holder.getText()) && !(holder.getSymbol()?.getDeclarations() ?? []).some((each) => Node.isParameterDeclaration(each))) return;
    const undeclared = undeclaredPageGlobal(holder, pageLoaded, declared);
    if (undeclared === undefined) return;
    const { factory, name } = undeclared;
    const requested = Node.isPropertyAccessExpression(callee)
      ? Object.hasOwn(factory.verbs, callee.getName().toLowerCase())
      : factory.called !== undefined && node.getArguments().length > 0;
    if (!requested) return;
    saidUndeclared.add(node);
    // What the script's linter configuration names and was not followed, which may be what declares it (P341).
    const unfollowed = declared.unfollowed(node.getSourceFile());
    ctx.report({
      file: ctx.fileOf(node),
      line: siteOf(node).line,
      reason: 'api-client-global-undeclared',
      message:
        `${callee.getText().slice(0, 60)}(…) calls ${name}, the global ${factory.client.name}'s browser build leaves, and nothing says the page has it, so it is not read as a request` +
        (unfollowed.length === 0 ? '' : `; the linter configuration names what was not followed: ${unfollowed.join('; ')}`),
      hint:
        `Nothing imports ${name}, loads ${factory.modules.join(' or ')} by a script tag of a page, or declares the global - a /* global ${name} */ comment, ` +
        'or the globals of the linter configuration the script is under. Load the client by a script tag, import it, or declare the global, and the call is read as its request.' +
        (unfollowed.length === 0
          ? ''
          : ' A configuration the linter configuration names was not followed and may be what declares it: install it inside the repository, or name it by a path, an import or members that are read.'),
      symbol: node.getText().slice(0, 80),
      meta: { cause: 'api-client-global-undeclared', client: factory.client.name, global: name, ...(unfollowed.length === 0 ? {} : { unfollowedConfigs: unfollowed }) },
    });
  };

  /** Every request spelling this reader knows, found in one body. */
  const callsIn = (body: TsNode, leaveOut?: ReadonlySet<TsNode>): FoundCall[] => {
    const found = describedCallsIn(body, leaveOut);
    const already = new Set(found.map((call) => call.call));
    if (clients.length > 0) for (const call of already) describedAt(call, true);
    forEachCall(body, (node) => {
      if (!Node.isCallExpression(node) || already.has(node)) return;
      const described = describedAt(node, false);
      if (described !== undefined) {
        found.push(described);
        return;
      }
      const callee = node.getExpression();
      const local = Node.isPropertyAccessExpression(callee) ? localCallAt(node, callee.getExpression(), callee.getName().toLowerCase()) : undefined;
      if (local !== undefined) found.push(local);
      else sayUndeclaredGlobal(node);
    }, leaveOut);
    return found;
  };

  /**
   * One request per caller of a function that reads its address in place and
   * is handed its verb (P91), or nothing when the verb is not a parameter. A
   * caller outside any indexed function keeps the request where it is
   * written, verb unread.
   */
  const perVerbCaller = (found: FoundCall, request: ReadRequest): boolean => {
    if (verbOf(found.call, found.shape) !== null) return false;
    const parameter = verbParameterOf(verbWrittenIn(found.call, found.shape));
    if (parameter === undefined) return false;
    const callers = verbsAtCallers(parameter);
    let unnamed = callers.undecided || callers.calls.length === 0;
    for (const caller of callers.calls) {
      const owner = enclosingIndexed(ctx, caller.site, isClientClass);
      if (owner === undefined) {
        unnamed = true;
        continue;
      }
      ensureOwner(ctx, owner.id);
      record(
        found,
        { ...request, site: { call: caller.site, ownerId: owner.id, file: owner.file }, calls: caller.hops },
        caller.verb,
      );
    }
    if (unnamed) record(found, request);
    return true;
  };

  for (const indexed of [...ctx.functions.all(), ...classMethods(ctx, isClientClass)]) {
    const found = callsIn(indexed.fn.body, ctx.functions.nestedIn(indexed));
    if (found.length === 0) continue;
    ctx.ensureFunctionNode(indexed.fn);
    for (const call of found) {
      const urlArg = call.described === undefined ? addressWrittenIn(call.call, call.shape) : (call.described.url ?? call.call);
      if (urlArg === undefined) continue;
      const site: RequestSite = { call: call.call, ownerId: indexed.id, file: indexed.file };
      for (const request of requestsOf(ctx, urlArg, indexed, site, isClientClass)) {
        ensureOwner(ctx, request.site.ownerId);
        if (request.depth === 0 && call.held !== undefined) {
          // Each caller of the method, under the base of the instance it
          // calls it on (P324), followed out to whoever hands that one
          // (P330): the request is the callers', not whoever else makes an
          // instance. Where they are not all read, each maker's (P312).
          // A method a framework calls is placed at the instance it holds,
          // where one is registered with it, and is said where none is (P336).
          const said: { framework?: string } = {};
          const held = heldAtCallers(call, request, said);
          if (held === undefined && said.framework !== undefined) reportFrameworkHeld(call, said.framework);
          recordHeld(call, request, indexed.name, held);
          continue;
        }
        if (call.held !== undefined) {
          recordHeldAlong(call, request);
          continue;
        }
        if (request.depth === 0 && call.described === undefined && perVerbCaller(call, request)) continue;
        record(call, request);
      }
    }
  }
});

/** The names the clients' browser builds leave on the page (P310, P311). */
const PAGE_GLOBAL_NAMES: ReadonlySet<string> = new Set(CLIENT_FACTORIES.flatMap((factory) => factory.pageGlobals ?? []));

/** The verbs those clients are called by on their global (P323). */
const PAGE_GLOBAL_VERBS: ReadonlySet<string> = new Set(CLIENT_FACTORIES.flatMap((factory) => (factory.pageGlobals === undefined ? [] : Object.keys(factory.verbs))));

/**
 * The query of a request whose data a client writes into the address (P317),
 * beside the query it is handed otherwise (P323): superagent's `.query(q)`
 * and `.send(data)` on one `GET` are both its query string, as is a query
 * written into the address. Keys are known only where each side's are; a
 * side not read leaves the whole unread.
 */
const withSentQuery = (
  among: { type?: string; keys?: readonly string[]; unread?: true; inAddress?: true },
  sent: { type: string | null; keys?: readonly string[] },
): { type?: string; keys?: readonly string[]; unread?: true; inAddress?: true } => {
  const sentType = sent.type as string;
  if (among.type === undefined && among.keys === undefined && among.unread !== true) return { type: sentType, ...(sent.keys === undefined ? {} : { keys: sent.keys }) };
  const type = among.type === undefined ? sentType : `${among.type} & ${sentType}`;
  if (among.unread === true) return { type, unread: true };
  if (among.keys === undefined || sent.keys === undefined) return { type };
  return { type, keys: [...new Set([...among.keys, ...sent.keys])].sort(), ...(among.inAddress === true ? { inAddress: true as const } : {}) };
};

/**
 * Creates the node a request is attributed to, wherever it turned out to be.
 *
 * A request followed out to a caller hangs off that caller, and nothing else
 * has necessarily created its node yet.
 */
const ensureOwner = (ctx: ReactExtractContext, id: string): void => {
  const indexed: IndexedFunction | undefined = ctx.functions.byId(id);
  if (indexed !== undefined) ctx.ensureFunctionNode(indexed.fn);
};
