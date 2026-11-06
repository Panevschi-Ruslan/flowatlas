import {
  applicationOfFile,
  forEachCall,
  makeExternalApiId,
  isPlatformProvided,
  makeLeafId,
  requestBodyOf,
  requestVerbOf,
  resolveTypeOrigin,
  siteOf,
  verbAlong,
  verbParameterOf,
  verbsAtCallers,
  wasRead,
  writtenKeysOf,
  describedRequestsAt,
  PLATFORM_FETCH,
  precedenceOf,
  precedenceRows,
  toPosixPath,
  type DescribedRequest,
  type TypeOrigin,
} from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  BASE_FIELDS,
  CLIENT_FACTORIES,
  REQUEST_CLIENTS,
  VERB_CALLS,
  type CallShape,
  type RequestClient,
} from '../clients.js';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { clientInstances, type ClientInstance } from '../util/client-instance.js';
import { enclosingIndexed, requestsOf, type ReadRequest, type RequestSite } from '../util/forward.js';
import { localClientOf, type LocalClientReading } from '../util/local-client.js';
import { basedBy } from '../util/request-rewrite.js';
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
    const read = requestVerbOf(call, { ...PLATFORM_FETCH, optionsAt: shape.optionsAt ?? PLATFORM_FETCH.optionsAt });
    if (read !== null || chain.length === 0) return read;
    // A verb the wrapper is handed, read at the caller its address was read
    // at, along the same calls (P91).
    const parameter = verbParameterOf(verbWrittenIn(call, shape));
    return parameter === undefined ? null : (verbAlong(parameter, chain) ?? null);
  };

  /** Where a call writes its verb, when it writes one in its options. */
  const verbWrittenIn = (call: CallExpression, shape: CallShape): TsNode | undefined => {
    if (shape.method !== null || shape.optionsAt === undefined) return undefined;
    return objectAt(call, shape.optionsAt)?.getProperty('method');
  };

  const typeOfResponse = (call: CallExpression): string | null => {
    const [written] = call.getTypeArguments();
    return written === null || written === undefined
      ? null
      : ctx.types.collectType(written.getType(), call);
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
    if (written === undefined) return { type: null };
    const keys = writtenKeysOf([written]);
    return {
      type: ctx.types.collectType(written.getType(), written),
      ...(keys === undefined ? {} : { keys }),
    };
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
  const instances = clientInstances({
    sharedPackages: ctx.config.sharedPackages,
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
        'Requests through it are recorded under the base the instance is made with, or the path each call writes where it is made with none, and this function may change either. Set the base unconditionally, to a literal, a settings key or a constant.',
      );
    }
  };

  const record = (found: FoundCall, request: ReadRequest, handedIn?: string | null): void => {
    const { call: network, client, shape } = found;
    const { site } = request;
    if (found.instance !== undefined) reportUnreadBase(found.instance);
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
    const base = basedBy(found.instance?.rewrite, before);
    const rewritten = base !== before;
    const address = underBase(base, request.address);
    const at = siteOf(site.call);
    const leaf = makeLeafId('ui_api_call', ctx.repo, site.file, at.line, at.column);
    // One caller may reach a wrapper that writes several requests, so where the
    // request was followed out to a caller the id also carries where the
    // network is reached.
    const network_at = siteOf(network);
    const id = request.depth === 0 ? leaf : `${leaf}@${network_at.line}:${network_at.column}`;

    const verb =
      handedIn !== undefined ? handedIn : found.described !== undefined ? found.described.verb : verbOf(network, shape, request.calls);
    const body = found.described === undefined ? bodyOf(network, client, shape) : describedBodyOf(found.described);
    const application = applicationOfFile(ctx.meta, site.file);

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
        responseType: typeOfResponse(network),
        bodyType: body.type,
        ...(body.type === null ? {} : { bodyFrom: 'literal' }),
        ...(body.keys === undefined ? {} : { bodyKeys: body.keys }),
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
        ...(rewritten ? { baseFrom: 'interceptor' } : written?.kind === 'base' ? { baseFrom: 'call' } : {}),
        ...(found.local === undefined ? {} : { localClient: found.local }),
        via: address.via,
        ...(found.described?.client.describedBy === undefined ? {} : { describedBy: found.described.client.describedBy }),
        ...(address.host === null ? {} : { host: address.host }),
        ...(address.guessed ? { guessed: true } : {}),
        ...(request.through === undefined ? {} : { through: request.through }),
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
    }
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
  const describedCallsIn = (body: TsNode): FoundCall[] => {
    const found: FoundCall[] = [];
    forEachCall(body, (node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();

      if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        for (const client of REQUEST_CLIENTS) {
          const shape = client.callee;
          if (shape === undefined || !shape.names.includes(name)) continue;
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
        } else found.push({ call: node, client, shape });
        return;
      }
      // Known by how it was made, where its type is not known: the package's
      // own import, followed to the instance it makes (P239). Asked only of a
      // name some instance answers to, since every member call passes here.
      if (!INSTANCE_VERBS.has(method)) return;
      const instance = instances.of(receiver);
      if (instance === undefined) return;
      const verbs = instance.factory.verbs;
      const shape = Object.hasOwn(verbs, method) ? verbs[method] : undefined;
      if (shape !== undefined) found.push({ call: node, client: clientOf(instance), shape, instance });
    });
    return found;
  };

  /**
   * What each class of this repository turned out to be, asked once.
   *
   * One class carries every request in an application — that is what makes it
   * worth reading — so the same declaration is reached from a hundred call sites,
   * and the walk over its members is the expensive part of this pass.
   */
  const readings = new Map<ClassDeclaration, LocalClientReading>();
  const readingOf = (cls: ClassDeclaration): LocalClientReading => {
    if (readings.has(cls)) return readings.get(cls);
    const reading = localClientOf(cls, {
      reaches: (body) => describedCallsIn(body).length > 0,
      declared: ctx.config.adapters.frontend.localClientClasses,
      address: (node) => analyzeClientBase(node, { sharedPackages: ctx.config.sharedPackages }),
      // The base of each instance the class's members write through, and the
      // one that could not be read said where it is made (P239).
      basesIn: (body) =>
        describedCallsIn(body).map((found) => {
          if (found.instance !== undefined) reportUnreadBase(found.instance);
          return found.instance === undefined ? null : (basedBy(found.instance.rewrite, found.instance.base) ?? null);
        }),
    });
    readings.set(cls, reading);
    return reading;
  };

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
    const cls = localClassOf(callee);
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
    return shape === undefined
      ? undefined
      : { call: node, client: reading.client, shape, local: reading.via };
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

  /** Every request spelling this reader knows, found in one body. */
  const callsIn = (body: TsNode): FoundCall[] => {
    const found = describedCallsIn(body);
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
      if (!Node.isPropertyAccessExpression(callee)) return;
      const local = localCallAt(node, callee.getExpression(), callee.getName().toLowerCase());
      if (local !== undefined) found.push(local);
    });
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
      const owner = enclosingIndexed(ctx, caller.site);
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

  for (const indexed of ctx.functions.all()) {
    const found = callsIn(indexed.fn.body);
    if (found.length === 0) continue;
    ctx.ensureFunctionNode(indexed.fn);
    for (const call of found) {
      const urlArg = call.described === undefined ? addressWrittenIn(call.call, call.shape) : (call.described.url ?? call.call);
      if (urlArg === undefined) continue;
      const site: RequestSite = { call: call.call, ownerId: indexed.id, file: indexed.file };
      for (const request of requestsOf(ctx, urlArg, indexed, site)) {
        ensureOwner(ctx, request.site.ownerId);
        if (request.depth === 0 && call.described === undefined && perVerbCaller(call, request)) continue;
        record(call, request);
      }
    }
  }
});

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
