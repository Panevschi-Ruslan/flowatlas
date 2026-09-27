import {
  evaluateExpression,
  forEachCall,
  makeExternalApiId,
  makeLeafId,
  originOfValue,
  resolveTypeOrigin,
  siteOf,
  wasRead,
  writtenKeysOf,
  type TypeOrigin,
} from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { REQUEST_CLIENTS, VERB_CALLS, type CallShape, type RequestClient } from '../clients.js';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { requestsOf, type ReadRequest, type RequestSite } from '../util/forward.js';
import { localClientOf, type LocalClientReading } from '../util/local-client.js';
import { analyzeApiUrl, analyzeClientBase, underBase } from '../util/url.js';
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
 * Whether a bare name stands for something the browser provides.
 *
 * The same reasoning the other front-end reader applies to `EventSource`, and
 * it matters more here: `fetch` is the most commonly shadowed name in a React
 * repository, because a repository that wraps it names the wrapper after it. A
 * function declared here is that wrapper and is followed as ordinary code; a
 * name the checker will not resolve at all is the ambient global in a
 * repository whose compiler settings leave the browser's library out.
 */
const isProvided = (expression: TsNode): boolean => originOfValue(expression).kind !== 'local';

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
   * The verb one call sends.
   *
   * Null means it was not read, which is a different thing from absent: a call
   * with no options at all is the protocol's own default and is `GET` for
   * certain, while a call handed an options object assembled elsewhere could
   * be anything and saying `GET` about it would be an invention.
   */
  const verbOf = (call: CallExpression, shape: CallShape): string | null => {
    if (shape.method !== null) return shape.method;
    if (shape.optionsAt === undefined) return null;
    const written = call.getArguments()[shape.optionsAt];
    if (written === undefined) return 'GET';
    const object = objectAt(call, shape.optionsAt);
    if (object === undefined) return null;
    const value = valueOf(object, 'method');
    if (value === undefined) return 'GET';
    const evaluated = evaluateExpression(value);
    return evaluated.resolved === true && typeof evaluated.value === 'string'
      ? evaluated.value.toUpperCase()
      : null;
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
    if (shape.bodyAt === undefined) return { type: null };
    const written =
      client.callee === undefined
        ? call.getArguments()[shape.bodyAt]
        : serialised(valueOf(objectAt(call, shape.bodyAt), 'body'));
    if (written === undefined) return { type: null };
    const keys = writtenKeysOf([written]);
    return {
      type: ctx.types.collectType(written.getType(), written),
      ...(keys === undefined ? {} : { keys }),
    };
  };

  /** `JSON.stringify(order)` is the order; anything else is itself. */
  const serialised = (written: TsNode | undefined): TsNode | undefined => {
    if (written === undefined || !Node.isCallExpression(written)) return written;
    const callee = written.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'stringify') return written;
    return written.getArguments()[0] ?? written;
  };

  const record = (found: FoundCall, request: ReadRequest): void => {
    const { call: network, client, shape } = found;
    const { site } = request;
    // The path at the call site is written under whatever base its client holds,
    // so the address is the two of them together. Recorded that way rather than
    // forgiven later: `impact`, `dead` and `contracts` all read what is written
    // here, and a recorded address missing a segment is wrong in the graph
    // whether or not the linker happens to forgive it (R114).
    const address = underBase(client.base, request.address);
    const at = siteOf(site.call);
    const leaf = makeLeafId('ui_api_call', ctx.repo, site.file, at.line, at.column);
    // One caller may reach a wrapper that writes several requests, so where the
    // request was followed out to a caller the id also carries where the
    // network is reached.
    const network_at = siteOf(network);
    const id = request.depth === 0 ? leaf : `${leaf}@${network_at.line}:${network_at.column}`;

    const verb = verbOf(network, shape);
    const body = bodyOf(network, client, shape);

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
        ...(found.local === undefined ? {} : { localClient: found.local }),
        via: address.via,
        ...(address.host === null ? {} : { host: address.host }),
        ...(address.guessed ? { guessed: true } : {}),
        ...(request.through === undefined ? {} : { through: request.through }),
      },
    });
    ctx.builder.addEdge({
      from: site.ownerId,
      to: id,
      type: 'calls',
      confidence: address.path === null || verb === null ? 'heuristic' : 'static',
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
          if (!isProvided(callee)) continue;
          found.push({ call: node, client, shape });
          return;
        }
        return;
      }

      if (!Node.isPropertyAccessExpression(callee)) return;
      const method = callee.getName().toLowerCase();
      const origin = resolveTypeOrigin(callee.getExpression());
      for (const client of REQUEST_CLIENTS) {
        const shape = client.receiver?.verbs[method];
        if (shape === undefined || !isClientValue(origin, client)) continue;
        found.push({ call: node, client, shape });
        return;
      }
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
   * is handed a path, written in full, at the call site. Measured on outline, the
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
    if (!(verb in VERB_CALLS)) return undefined;
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
    const shape = reading.client.receiver?.verbs[verb];
    return shape === undefined
      ? undefined
      : { call: node, client: reading.client, shape, local: reading.via };
  };

  /** Every request spelling this reader knows, found in one body. */
  const callsIn = (body: TsNode): FoundCall[] => {
    const found = describedCallsIn(body);
    const already = new Set(found.map((call) => call.call));
    forEachCall(body, (node) => {
      if (!Node.isCallExpression(node) || already.has(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      const local = localCallAt(node, callee.getExpression(), callee.getName().toLowerCase());
      if (local !== undefined) found.push(local);
    });
    return found;
  };

  for (const indexed of ctx.functions.all()) {
    const found = callsIn(indexed.fn.body);
    if (found.length === 0) continue;
    ctx.ensureFunctionNode(indexed.fn);
    for (const call of found) {
      const urlArg = call.call.getArguments()[call.shape.urlAt];
      if (urlArg === undefined) continue;
      const site: RequestSite = { call: call.call, ownerId: indexed.id, file: indexed.file };
      for (const request of requestsOf(ctx, urlArg, indexed, site)) {
        ensureOwner(ctx, request.site.ownerId);
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
