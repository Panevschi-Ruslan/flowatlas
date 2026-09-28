import {
  applicationOfFile,
  declaredParameterType,
  evaluateExpression,
  forEachCall,
  isPlatformRequest,
  makeExternalApiId,
  makeLeafId,
  methodBodies,
  narrowUnionByLiteral,
  parametersOf,
  PLATFORM_FETCH,
  requestBodyOf,
  requestVerbOf,
  resolveTypeOrigin,
  siteOf,
  writtenBodyOutward,
  writtenKeysOf,
  type BodyRead,
  type CallFrame,
  type ClassMethod,
  type TypeOrigin,
} from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { ANGULAR_HTTP } from '../index-classes.js';
import { noteIfUnreferenced, requestIdOf, requestsOf, wrapperOf, type RequestSite } from '../util/forward.js';
import type { ApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * What each method of the client sends, and where it writes the address.
 *
 * A `Map`, because it is asked about every method called on the client and an
 * object literal answers `toString` with the language's own function (R130).
 */
const VERBS: ReadonlyMap<string, { method: string; urlIndex: number; bodyIndex: number | null }> = new Map([
  ['get', { method: 'GET', urlIndex: 0, bodyIndex: null }],
  ['post', { method: 'POST', urlIndex: 0, bodyIndex: 1 }],
  ['put', { method: 'PUT', urlIndex: 0, bodyIndex: 1 }],
  ['patch', { method: 'PATCH', urlIndex: 0, bodyIndex: 1 }],
  ['delete', { method: 'DELETE', urlIndex: 0, bodyIndex: null }],
  ['head', { method: 'HEAD', urlIndex: 0, bodyIndex: null }],
  ['options', { method: 'OPTIONS', urlIndex: 0, bodyIndex: null }],
  ['jsonp', { method: 'GET', urlIndex: 0, bodyIndex: null }],
  // The verb of a generic request is its first argument, not its name.
  ['request', { method: '', urlIndex: 1, bodyIndex: null }],
]);

/**
 * Whether a call is made on the framework's HTTP client.
 *
 * The subpath the client is imported from is not the package it belongs to, so
 * both spellings are accepted; the type name is what actually decides.
 */
const isHttpClient = (origin: TypeOrigin | null): boolean =>
  origin?.typeName === 'HttpClient' &&
  (origin.package === '@angular/common' || origin.package === ANGULAR_HTTP);

/** A body shape, where it was read from, and the keys it actually writes. */
interface BodyShape {
  type: string | null;
  from: BodyRead;
  keys?: readonly string[];
}

/**
 * How one request is read, whichever client it was written with.
 *
 * Two clients, and a request reads the same way through either once it is
 * known where its parts sit: the framework's, whose verb is the method's name,
 * and the platform's `fetch`, whose verb and body sit in an options object. The
 * second is described in the core, once, for this reader and the React one
 * alike (R140).
 */
interface Spelling {
  readonly urlIndex: number;
  readonly verb: (network: CallExpression) => string | null;
  /** The body, where the call is `network` and `frames` are the callers it was followed out to. */
  readonly body: (network: CallExpression, frames: readonly CallFrame[]) => BodyShape;
  /** Whether the call states what answers it: `fetch` answers with a `Response`, whatever the route sends. */
  readonly typedAnswer: boolean;
  /** What the node records about the client, beside the request itself. */
  readonly client: Readonly<Record<string, unknown>>;
}

/**
 * Requests the browser makes.
 *
 * This is where Angular pays for itself: the address, the verb and the type of
 * the answer are all written at one call site, so a node here carries everything
 * the linker needs to join it to the route that serves it and everything P10
 * needs to compare the two sides of that boundary.
 */
export const httpPass = definePass('http', (ctx: AngularExtractContext) => {
  const apiBaseEnv = ctx.service.apiBaseEnv ?? [];

  const verbOf = (call: CallExpression, name: string): string | null => {
    const shape = VERBS.get(name);
    if (shape === undefined) return null;
    if (shape.method !== '') return shape.method;
    const [written] = call.getArguments();
    const value = written === undefined ? undefined : evaluateExpression(written);
    return value?.resolved === true && typeof value.value === 'string'
      ? value.value.toUpperCase()
      : null;
  };

  /** The framework's client, called by one of its verb methods. */
  const httpClient = (name: string): Spelling | undefined => {
    const shape = VERBS.get(name);
    if (shape === undefined) return undefined;
    return {
      urlIndex: shape.urlIndex,
      verb: (network) => verbOf(network, name),
      body: (network, frames) =>
        frames.length === 0
          ? typeOfBody(network, shape.bodyIndex)
          : bodyThrough(network, shape.bodyIndex, frames),
      typedAnswer: true,
      client: { package: ANGULAR_HTTP },
    };
  };

  /** The platform's client, read through the one description of it. */
  const platformFetch: Spelling = {
    urlIndex: PLATFORM_FETCH.urlAt,
    verb: (network) => requestVerbOf(network),
    // Written inside the options rather than beside them, and followed out to
    // whoever wrote it the same way a framework request's body is.
    body: (network) => {
      const written = requestBodyOf(network);
      if (written === undefined) return NO_BODY;
      return { type: ctx.types.collectType(written.getType(), written), ...bodyKeysOf(written) };
    },
    typedAnswer: false,
    client: { package: null, client: PLATFORM_FETCH.name },
  };

  const typeOfResponse = (call: CallExpression): string | null => {
    const [written] = call.getTypeArguments();
    if (written !== undefined) return ctx.types.collectType(written.getType(), call);
    const returned = ctx.types.unwrapAsync(call.getReturnType());
    if (returned.isAny() || returned.isUnknown() || returned.isVoid()) return null;
    return ctx.types.collectType(returned, call);
  };

  /**
   * The shape a request puts on the wire, and where that was read from.
   *
   * An object written at the call site is the body. A name, or a value built
   * elsewhere, has only its declared type to go on, and a declared type says
   * what is permitted rather than what is sent — which is a weaker claim, and
   * one the finding then has to phrase as the weaker claim it is (R34).
   */
  const NO_BODY: BodyShape = { type: null, from: 'type' };

  /**
   * The keys a body writes, followed out to whoever wrote it.
   *
   * The address and the body are not decided in the same place: a service
   * method writes `this.url(id, 'zones')` and takes the body as a parameter, so
   * the address stops travelling there and the body does not (R34).
   */
  const bodyKeysOf = (argument: TsNode): { from: BodyRead; keys?: readonly string[] } => {
    const written = writtenBodyOutward(argument);
    const keys = writtenKeysOf(written);
    if (keys === undefined) return { from: 'type' };
    // One writer means the keys are what this call sends, every time. Several
    // mean they are what any of its callers may send, which is a weaker claim
    // and has to be worded as one (R34).
    return { from: written.length === 1 ? 'literal' : 'literals', keys };
  };

  const typeOfBody = (call: CallExpression, index: number | null): BodyShape => {
    if (index === null) return NO_BODY;
    const argument = call.getArguments()[index];
    if (argument === undefined) return NO_BODY;
    const declared = declaredParameterType(call, index, ctx.checker);
    const narrowed = declared === undefined ? undefined : narrowUnionByLiteral(declared, argument);
    return {
      type: ctx.types.collectType(narrowed ?? argument.getType(), argument),
      ...bodyKeysOf(argument),
    };
  };

  /**
   * The body a request carries, followed out to the caller that wrote it.
   *
   * A wrapper passes on what it was given — `post(path, body)` sends `body ?? {}`
   * — so the body only has a shape at the call site. A body the wrapper writes
   * itself, like the `{}` of a delete sent as a post, is its own.
   */
  const bodyThrough = (
    call: CallExpression,
    index: number | null,
    frames: readonly CallFrame[],
  ): BodyShape => {
    if (index === null) return NO_BODY;
    let node: TsNode | undefined = call.getArguments()[index];
    let at: CallExpression = call;
    let position = index;
    for (const frame of frames) {
      if (node === undefined) return NO_BODY;
      let value: TsNode = node;
      while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value)) {
        value = value.getExpression();
      }
      if (
        Node.isBinaryExpression(value) &&
        value.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken
      ) {
        value = value.getLeft();
      }
      if (!Node.isIdentifier(value)) break;
      const declaration = value.getSymbol()?.getDeclarations()[0];
      const parameterIndex = parametersOf(frame.method).findIndex(
        (parameter) => parameter === declaration,
      );
      if (parameterIndex < 0) break;
      node = frame.call.getArguments()[parameterIndex];
      at = frame.call;
      position = parameterIndex;
    }
    return node === undefined ? NO_BODY : typeOfBody(at, position);
  };

  const record = (
    network: CallExpression,
    spelling: Spelling,
    site: RequestSite,
    address: ApiUrl,
    frames: readonly CallFrame[],
    choice?: string,
    pathChoices?: readonly string[],
  ): void => {
    const { call, methodId, file } = site;

    const verb = spelling.verb(network);
    const at = siteOf(call);
    const leaf = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    // One call reaching one of several segments a table spells out is one
    // request per segment, and each needs a node of its own.
    const id = requestIdOf(leaf, network, { frames, ...(choice === undefined ? {} : { choice }) });
    const responseType = spelling.typedAnswer && Node.isCallExpression(call) ? typeOfResponse(call) : null;
    const body = spelling.body(network, frames);
    const bodyType = body.type;
    const application = applicationOfFile(ctx.meta, file);

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${verb ?? '?'} ${address.path ?? address.url ?? '?'}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'http',
      meta: {
        method: verb,
        url: address.url,
        path: address.path,
        baseUrlEnv: address.baseUrlEnv,
        responseType,
        bodyType,
        // Whether the shape above is what the call writes or only what its
        // declared type permits, so a finding can say which (R34).
        ...(bodyType === null ? {} : { bodyFrom: body.from }),
        // The keys the call actually writes, where an object written in the
        // source says. A declared type says what is permitted; this says what
        // is sent, and the checker compares only these (R34).
        ...(body.keys === undefined ? {} : { bodyKeys: body.keys }),
        ...spelling.client,
        // Which application this request is written in, where the service holds
        // more than one; the other half of what an entry records about its own
        // address (R132).
        ...(application === undefined ? {} : { application }),
        via: address.via,
        ...(address.host === null ? {} : { host: address.host }),
        // Only ever set, never set to false: it is a mark on the few addresses
        // a branch was guessed for, and the linker lowers the edge it draws
        // from one. Everything without it was read outright.
        ...(address.guessed ? { guessed: true } : {}),
        // The request is written in a wrapper and made here. Naming the wrapper
        // keeps the one line that reaches the network findable from every call.
        ...(frames.length === 0 ? {} : { through: wrapperOf(network) }),
        ...(choice === undefined ? {} : { choice }),
        // The same address once per value a closed segment of it can take. The
        // joiner tries these when matching the address as written lands on a
        // catch-all or on nothing at all (R31).
        ...(pathChoices === undefined ? {} : { pathChoices }),
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: id,
      type: 'calls',
      confidence: address.path === null || verb === null ? 'heuristic' : 'static',
      file,
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
        file,
        line: at.line,
      });
    }

    if (address.path === null) {
      ctx.report({
        file,
        line: at.line,
        reason: 'api-path-dynamic',
        hint: 'The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.',
        symbol: call.getText().slice(0, 80),
      });
    }
    if (verb === null) {
      ctx.report({
        file,
        line: at.line,
        reason: 'api-method-dynamic',
        hint: 'The verb is chosen at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.',
        symbol: call.getText().slice(0, 80),
      });
    }
    if (
      address.baseUrlEnv !== null &&
      apiBaseEnv.length > 0 &&
      !apiBaseEnv.includes(address.baseUrlEnv)
    ) {
      ctx.report({
        file,
        line: at.line,
        reason: 'api-base-unknown',
        hint: `Add ${address.baseUrlEnv} to services[].apiBaseEnv, and services[].apiTarget to say which service answers it.`,
        symbol: call.getText().slice(0, 80),
      });
    }
  };

  /**
   * Records one request, at the call that decides its address.
   *
   * Written where the network is reached when it can be read there, and at each
   * caller of a wrapper when it cannot (see `requestsOf`).
   */
  const emit = (
    network: CallExpression,
    spelling: Spelling,
    method: ClassMethod,
    site: RequestSite,
    siblings: number,
  ): void => {
    const urlArg = network.getArguments()[spelling.urlIndex];
    if (urlArg === undefined) return;
    for (const request of requestsOf(ctx, urlArg, method, site, siblings)) {
      noteIfUnreferenced(ctx, request.site);
      record(
        network,
        spelling,
        request.site,
        request.address,
        request.frames,
        request.choice,
        request.pathChoices,
      );
    }
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const { declaration: method, body } of methodBodies(indexed.declaration)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;

      const found: Array<{ site: CallExpression; spelling: Spelling }> = [];
      forEachCall(body, (site: TsNode) => {
        if (!Node.isCallExpression(site)) return;
        if (isPlatformRequest(site)) {
          found.push({ site, spelling: platformFetch });
          return;
        }
        const callee = site.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const spelling = httpClient(callee.getName().toLowerCase());
        if (spelling === undefined) return;
        if (!isHttpClient(resolveTypeOrigin(callee.getExpression()))) return;
        found.push({ site, spelling });
      });
      for (const { site, spelling } of found) {
        ctx.ensureMethodNode(method);
        emit(site, spelling, method, { call: site, methodId, file: indexed.file }, found.length);
      }
    }
  }
});
