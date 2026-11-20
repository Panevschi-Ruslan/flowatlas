import {
  applicationOfFile,
  callSitesOf,
  delegateOf,
  EVENT_SOURCE,
  isEventSourceConstruction,
  isWrittenFunction,
  makeExternalApiId,
  makeLeafId,
  normalizeFilePath,
  recordStreamConsumer,
  siteOf,
  STREAM_KIND,
  streamHandlerUnreadRow,
  streamHoldingOf,
  type StreamListener,
} from '@flowatlas/core';
import type { CallExpression, NewExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { classMethods, enclosingIndexed, methodIndexed, requestsOf, type ReadRequest, type RequestSite } from '../util/forward.js';
import { definePass } from './types.js';

/** How many functions out a handler handed in as an argument is followed. */
const HANDED_DEPTH = 3;

/** The function a declaration names, as the checker sees it: an import is the declaration it imports. */
const declarationOf = (name: TsNode): TsNode | undefined => {
  const symbol = name.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getDeclarations()[0];
};

/** The body of a function written in any of the ways a parameter can belong to one. */
const bodyOfFunction = (fn: TsNode): TsNode | undefined =>
  Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn) || Node.isMethodDeclaration(fn)
    ? fn.getBody()
    : undefined;

/** What a caller of `fn` names it by, for finding the calls of it. */
const holderOfFunction = (fn: TsNode): Parameters<typeof callSitesOf>[0] | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn;
  const parent = fn.getParent();
  return parent !== undefined && Node.isVariableDeclaration(parent) ? parent : undefined;
};

/**
 * Streams of server-sent events a screen opens, and the functions their frames
 * arrive at (P359).
 *
 * The request is read as the other front-end reader reads it, and with the same
 * address reading every other request of this reader uses: one `GET`, held
 * open, joined to its route by the linker; a stream opened inside a hook or a
 * helper of the repository's own belongs to whoever hands it the address. The
 * handler is the function the frames arrive at - the one a listener written in
 * place calls, the function named, or a function handed into the helper by its
 * caller - recorded as a consumer the request `triggers`. Read for components,
 * hooks, plain modules and the scripts of single-file components alike, because
 * all of them are functions here.
 */
export const streamsPass = definePass('streams', (ctx: ReactExtractContext) => {
  const record = (network: NewExpression, request: ReadRequest): string => {
    const { site, address } = request;
    const at = siteOf(site.call);
    const leaf = makeLeafId('ui_api_call', ctx.repo, site.file, at.line, at.column);
    const networkAt = siteOf(network);
    const id = request.depth === 0 ? leaf : `${leaf}@${networkAt.line}:${networkAt.column}`;
    const application = applicationOfFile(ctx.meta, site.file);
    const defaultFrom =
      address.baseUrlEnv === null || address.baseUrlDefault === undefined || address.baseUrlDefaultFile === undefined
        ? undefined
        : normalizeFilePath(address.baseUrlDefaultFile, ctx.repoDir);

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `GET ${address.path ?? address.url ?? '?'}`,
      repo: ctx.repo,
      file: site.file,
      line: at.line,
      kind: STREAM_KIND,
      meta: {
        method: 'GET',
        url: address.url,
        path: address.path,
        baseUrlEnv: address.baseUrlEnv,
        ...(address.baseUrlEnv === null || address.baseUrlDefault === undefined ? {} : { baseUrlDefault: address.baseUrlDefault }),
        ...(defaultFrom === undefined || defaultFrom === site.file ? {} : { baseUrlDefaultFrom: defaultFrom }),
        ...(address.baseUrlEnv === null || address.baseUrlAlso === undefined ? {} : { baseUrlAlso: address.baseUrlAlso }),
        ...(address.baseUrlEnv === null || address.baseUrlEither === undefined ? {} : { baseUrlEither: address.baseUrlEither }),
        ...(address.baseUrlEnv === null || address.baseUrlAlsoTiers === undefined ? {} : { baseUrlAlsoTiers: address.baseUrlAlsoTiers }),
        // Nothing is sent, and what arrives is a sequence of frames rather
        // than one answer with a type the call site declares.
        responseType: null,
        bodyType: null,
        package: null,
        client: EVENT_SOURCE,
        ...(application === undefined ? {} : { application }),
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
      confidence: address.path === null ? 'heuristic' : 'static',
      file: site.file,
      line: at.line,
    });
    if (address.host !== null) {
      const apiId = makeExternalApiId(address.host);
      ctx.builder.addNode({ id: apiId, type: 'external_api', label: address.host, repo: ctx.repo, meta: { host: address.host } });
      ctx.builder.addEdge({ from: id, to: apiId, type: 'calls', confidence: 'static', file: site.file, line: at.line });
    }
    if (address.path === null) {
      ctx.report({
        file: site.file,
        line: at.line,
        reason: 'api-path-dynamic',
        hint: 'The address is built at run time. Annotate the function with /** @flowatlas-calls GET /path */.',
        symbol: network.getText().slice(0, 80),
      });
    }
    return id;
  };

  /**
   * The functions a handler stands for, or `undefined` where it is a value
   * this does not follow.
   *
   * Written in place, it is the function it calls where it does only that, and
   * the function it is written in otherwise. A name is the function declared by
   * it; a parameter is whatever each caller hands in its place - along the
   * calls the address was followed out through, where it was, and at every call
   * of the function otherwise.
   */
  const functionsOf = (handler: TsNode, chain: readonly CallExpression[], depth: number): IndexedFunction[] | undefined => {
    if (isWrittenFunction(handler)) {
      const callee = delegateOf(handler);
      const followed = callee === undefined ? undefined : named(callee, chain, depth);
      if (followed !== undefined && followed.length > 0) return followed;
      const around = enclosingIndexed(ctx, handler);
      return around === undefined ? undefined : [around];
    }
    return named(handler, chain, depth);
  };

  const named = (name: TsNode, chain: readonly CallExpression[], depth: number): IndexedFunction[] | undefined => {
    if (Node.isPropertyAccessExpression(name) && Node.isThisExpression(name.getExpression())) {
      const member = declarationOf(name.getNameNode());
      const method = member === undefined ? undefined : methodIndexed(ctx, member);
      return method === undefined ? undefined : [method];
    }
    if (!Node.isIdentifier(name)) return undefined;
    const declaration = declarationOf(name);
    if (declaration === undefined) return undefined;
    if (Node.isParameterDeclaration(declaration)) return handedIn(declaration, chain, depth);
    const indexed = ctx.functions.get(declaration);
    if (indexed !== undefined) return [indexed];
    // A function held by a name of a function's own, which the index does
    // not name: the function it is written in handles the frames.
    const value = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (value !== undefined && isWrittenFunction(value)) {
      const around = enclosingIndexed(ctx, value);
      return around === undefined ? undefined : [around];
    }
    return undefined;
  };

  /** What the callers of a function hand in place of one of its parameters. */
  const handedIn = (parameter: TsNode, chain: readonly CallExpression[], depth: number): IndexedFunction[] | undefined => {
    if (!Node.isParameterDeclaration(parameter) || depth >= HANDED_DEPTH) return undefined;
    const fn = parameter.getParent();
    const index = (fn as unknown as { getParameters(): TsNode[] }).getParameters().indexOf(parameter);
    const body = bodyOfFunction(fn);
    // The call of this function the address was followed out through, where it was.
    const along = chain.filter((call) => {
      const callee = call.getExpression();
      const target = Node.isIdentifier(callee) || Node.isPropertyAccessExpression(callee) ? declarationOf(Node.isIdentifier(callee) ? callee : callee.getNameNode()) : undefined;
      const targetBody = target === undefined ? undefined : Node.isVariableDeclaration(target) ? bodyOfFunction(target.getInitializer() ?? target) : bodyOfFunction(target);
      return targetBody !== undefined && targetBody === body;
    });
    const holder = holderOfFunction(fn);
    const calls = along.length > 0 ? along : holder === undefined ? [] : callSitesOf(holder);
    if (calls.length === 0) return undefined;
    const out: IndexedFunction[] = [];
    for (const call of calls) {
      const argument = call.getArguments()[index];
      if (argument === undefined) continue;
      const found = functionsOf(argument, chain, depth + 1);
      if (found === undefined) return undefined;
      out.push(...found);
    }
    return out;
  };

  /** Where the stream made at `network` is held: there, or at each caller it is handed back to. */
  const holdingsOf = (network: NewExpression, owner: IndexedFunction): { listeners: StreamListener[]; returned: boolean } => {
    const here = streamHoldingOf(network);
    if (!here.returned) return { listeners: [...here.listeners], returned: false };
    const holder = holderOfFunction(owner.fn.declaration);
    const listeners: StreamListener[] = [];
    for (const call of holder === undefined ? [] : callSitesOf(holder)) listeners.push(...streamHoldingOf(call).listeners);
    return { listeners, returned: true };
  };

  /** The functions the stream's frames arrive at, joined to every request it stands for. */
  const consumersOf = (network: NewExpression, owner: IndexedFunction, requests: readonly { id: string; chain: readonly CallExpression[] }[]): void => {
    const at = siteOf(network);
    const holding = holdingsOf(network, owner);
    if (holding.listeners.length === 0) {
      ctx.report(streamHandlerUnreadRow(owner.file, at.line, owner.name, holding.returned ? 'unread' : 'none'));
      return;
    }
    for (const listener of holding.listeners) {
      const file = ctx.fileOf(listener.site);
      const line = siteOf(listener.site).line;
      const reported = new Set<string>();
      for (const { id, chain } of requests) {
        const handlers = functionsOf(listener.handler, chain, 0);
        if (handlers === undefined) {
          if (!reported.has(`${file}:${line}`)) ctx.report(streamHandlerUnreadRow(file, line, owner.name, 'unread'));
          reported.add(`${file}:${line}`);
          continue;
        }
        for (const handler of handlers) {
          ctx.ensureFunctionNode(handler.fn);
          recordStreamConsumer(ctx.builder, {
            repo: ctx.repo,
            callId: id,
            handlerId: handler.id,
            label: handler.name,
            file,
            line,
            events: [listener.event],
            confidence: 'static',
          });
        }
      }
    }
  };

  for (const indexed of [...ctx.functions.all(), ...classMethods(ctx)]) {
    const nested = ctx.functions.nestedIn(indexed);
    const found: NewExpression[] = [];
    const body = indexed.fn.body;
    if (isEventSourceConstruction(body)) found.push(body);
    body.forEachDescendant((node, traversal) => {
      if (Node.isClassDeclaration(node) || Node.isClassExpression(node) || nested?.has(node) === true) {
        traversal.skip();
        return;
      }
      if (isEventSourceConstruction(node)) found.push(node);
    });
    if (found.length === 0) continue;
    ctx.ensureFunctionNode(indexed.fn);
    for (const network of found) {
      const [urlArg] = network.getArguments();
      if (urlArg === undefined) continue;
      const site: RequestSite = { call: network, ownerId: indexed.id, file: indexed.file };
      const requests: { id: string; chain: readonly CallExpression[] }[] = [];
      for (const request of requestsOf(ctx, urlArg, indexed, site)) {
        const owner = ctx.functions.byId(request.site.ownerId);
        if (owner !== undefined) ctx.ensureFunctionNode(owner.fn);
        requests.push({ id: record(network, request), chain: request.calls });
      }
      consumersOf(network, indexed, requests);
    }
  }
});
