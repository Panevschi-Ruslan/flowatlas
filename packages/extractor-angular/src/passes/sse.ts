import {
  applicationOfFile,
  delegateOf,
  EVENT_SOURCE,
  isEventSourceConstruction,
  isWrittenFunction,
  lineAndColumnAt,
  makeExternalApiId,
  makeLeafId,
  methodBodies,
  methodNamedOn,
  recordStreamConsumer,
  recordSubjectSubscribers,
  siteOf,
  streamConsumerId,
  streamHandlerUnreadRow,
  streamHoldingOf,
  subjectRelayOf,
  type CallFrame,
  type ClassMethod,
  type StreamListener,
} from '@flowatlas/core';
import type { ClassDeclaration, NewExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { noteIfUnreferenced, requestIdOf, requestsOf, wrapperOf, type RequestSite } from '../util/forward.js';
import type { ApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/**
 * The browser's own client for a stream of server-sent events.
 *
 * Which construction is the browser's - and not a class of the repository's own
 * by that name - is asked of the core, which every reader of a screen asks the
 * same way (P359).
 */
const CLIENT = EVENT_SOURCE;

/**
 * Streams the browser subscribes to.
 *
 * A subscription over server-sent events is a request like any other: one `GET`
 * to one address, held open. So it is recorded as the request it is and joined to
 * the route that serves it by the same matcher, rather than as a consumer of a
 * channel — the browser never names a channel. It asks a route for a stream, and
 * what that route forwards onto it is the route's business, on the far side of a
 * service boundary (R08).
 *
 * The verb is never in doubt: the protocol has only one.
 *
 * The method the frames arrive at is the other half (P359): it is recorded as a
 * consumer the request `triggers`, and the linker joins it to whatever channels
 * the route relays onto the stream. It is read where the stream is held: the
 * method a listener written in place delegates to on `this`, or the method that
 * registered it, which is then its own step.
 */
export const ssePass = definePass('sse', (ctx: AngularExtractContext) => {
  const apiBaseEnv = ctx.service.apiBaseEnv ?? [];

  const record = (
    network: NewExpression,
    request: RequestSite,
    address: ApiUrl,
    frames: readonly CallFrame[],
    choice?: string,
  ): string => {
    const { call: site, methodId, file } = request;
    const at = siteOf(site);
    const leaf = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const id = requestIdOf(leaf, network, { frames, ...(choice === undefined ? {} : { choice }) });
    const application = applicationOfFile(ctx.meta, file);

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `GET ${address.path ?? address.url ?? '?'}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'sse',
      meta: {
        method: 'GET',
        url: address.url,
        path: address.path,
        baseUrlEnv: address.baseUrlEnv,
        // Nothing is sent, and what arrives is a sequence of frames rather than
        // one answer with a type the call site declares.
        responseType: null,
        bodyType: null,
        package: null,
        client: CLIENT,
        // Which application this request is written in, where the service holds
        // more than one; the other half of what an entry records about its own
        // address (R132).
        ...(application === undefined ? {} : { application }),
        via: address.via,
        ...(address.host === null ? {} : { host: address.host }),
        ...(address.guessed ? { guessed: true } : {}),
        ...(frames.length > 0 ? { through: wrapperOf(network) } : {}),
        ...(choice === undefined ? {} : { choice }),
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: id,
      type: 'calls',
      confidence: address.path === null ? 'heuristic' : 'static',
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
        hint: 'The address is built at run time. Annotate the method with /** @flowatlas-calls GET /path */.',
        symbol: site.getText().slice(0, 80),
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
        symbol: site.getText().slice(0, 80),
      });
    }
    return id;
  };

  /**
   * The method one listener hands the frames to: the one a listener written in
   * place calls on `this`, the one `this.handle` names, or else the method the
   * listener is written in. `undefined` where it is a value not followed.
   */
  const handlerOf = (listener: StreamListener, owner: ClassDeclaration, method: ClassMethod): ClassMethod | undefined => {
    const inPlace = isWrittenFunction(listener.handler);
    const named = inPlace ? delegateOf(listener.handler) : listener.handler;
    if (named !== undefined && Node.isPropertyAccessExpression(named) && Node.isThisExpression(named.getExpression())) {
      return methodNamedOn(owner, named.getName()) ?? (inPlace ? method : undefined);
    }
    return inPlace ? method : undefined;
  };

  /** The methods the stream made at `network` hands its frames to, each joined to every request it stands for. */
  const consumersOf = (
    network: NewExpression,
    method: ClassMethod,
    owner: ClassDeclaration,
    className: string,
    file: string,
    calls: readonly { id: string; site: TsNode }[],
  ): void => {
    const callIds = calls.map((call) => call.id);
    const holding = streamHoldingOf(network);
    const at = siteOf(network);
    const symbol = `${className}.${method.getName()}`;
    if (holding.listeners.length === 0) {
      // Handed back to a caller, which holds it where this does not look; or held by nothing.
      ctx.report(streamHandlerUnreadRow(file, at.line, symbol, holding.returned ? 'unread' : 'none'));
      return;
    }
    const byMethod = new Map<ClassMethod, StreamListener[]>();
    for (const listener of holding.listeners) {
      const handler = handlerOf(listener, owner, method);
      if (handler === undefined) {
        ctx.report(streamHandlerUnreadRow(file, siteOf(listener.site).line, symbol, 'unread'));
        continue;
      }
      byMethod.set(handler, [...(byMethod.get(handler) ?? []), listener]);
    }
    for (const [handler, listeners] of byMethod) {
      const handlerId = ctx.methodIdOf(handler);
      if (handlerId === undefined) continue;
      ctx.ensureMethodNode(handler);
      const line = listeners[0] === undefined ? at.line : siteOf(listeners[0].site).line;
      // A listener written in place that does more than delegate (P369): the
      // method it is written in stands for it, and the listener itself is read
      // for the types it chooses, where it is written.
      const inPlace = handler === method ? listeners.filter((listener) => isWrittenFunction(listener.handler) && delegateOf(listener.handler) === undefined) : [];
      for (const callId of callIds) {
        recordStreamConsumer(ctx.builder, {
          repo: ctx.repo,
          callId,
          handlerId,
          label: `${className}.${handler.getName()}`,
          file,
          line,
          events: listeners.map((listener) => listener.event),
          confidence: 'static',
        });
        for (const listener of inPlace) {
          let written: TsNode = listener.handler;
          while (Node.isParenthesizedExpression(written) || Node.isAsExpression(written)) written = written.getExpression();
          recordStreamConsumer(ctx.builder, {
            repo: ctx.repo,
            callId,
            handlerId,
            label: `${className}.${handler.getName()}`,
            file,
            line,
            events: listeners.map((each) => each.event),
            confidence: 'static',
            subscription: { ...lineAndColumnAt(written.getSourceFile(), written.getStart()), through: `${EVENT_SOURCE}.${listener.event ?? 'message'}` },
          });
        }
      }
      for (const listener of listeners) handOn(listener, handler, owner, handlerId, calls);
    }
  };

  /**
   * The subscriptions to a subject a listener pushes the frames into (P362):
   * `this._event$.next(data)`, exposed as `event$`, subscribed to by the
   * screens the service is injected into. Each method a `subscribe` is written
   * in is one more consumer of the stream, reached from its requests.
   */
  const handOn = (listener: StreamListener, handler: ClassMethod, owner: ClassDeclaration, handlerId: string, calls: readonly { id: string; site: TsNode }[]): void => {
    if (calls.length === 0) return;
    const written = isWrittenFunction(listener.handler) ? listener.handler : handler;
    const relay = subjectRelayOf(written, owner, ctx.project, ctx.repoDir);
    if (relay.subjects.length === 0) return;
    recordSubjectSubscribers(
      ctx.builder,
      relay,
      {
        repo: ctx.repo,
        calls,
        consumerId: streamConsumerId(handlerId),
        handlerOf: (subscribe) => {
          const member = subscribe.getFirstAncestor((node) => Node.isMethodDeclaration(node) || Node.isConstructorDeclaration(node) || Node.isPropertyDeclaration(node));
          const holder = member?.getParent();
          if (member === undefined || holder === undefined || !Node.isClassDeclaration(holder)) return undefined;
          const label = `${holder.getName() ?? 'default'}.${Node.isConstructorDeclaration(member) ? 'constructor' : (member as ClassMethod).getName()}`;
          if (Node.isConstructorDeclaration(member)) {
            // A subscription made when the class is built, as a component's constructor often makes it.
            const classNode = ctx.ensureClassNode(holder);
            if (classNode === undefined) return undefined;
            const id = `${classNode.id}.constructor`;
            ctx.builder.addNode({ id, type: 'method', label, repo: ctx.repo, file: ctx.fileOf(member), line: siteOf(member).line });
            return { id, label };
          }
          const id = ctx.methodIdOf(member as ClassMethod);
          if (id === undefined) return undefined;
          ctx.ensureMethodNode(member as ClassMethod);
          return { id, label };
        },
        fileOf: (node) => ctx.fileOf(node),
      },
      (row) => ctx.report(row),
    );
  };

  /** A stream opened in a wrapper belongs to whoever handed it the address. */
  const emit = (site: NewExpression, method: ClassMethod, at: RequestSite, owner: ClassDeclaration, className: string): void => {
    const [urlArg] = site.getArguments();
    if (urlArg === undefined) return;
    const calls: { id: string; site: TsNode }[] = [];
    for (const request of requestsOf(ctx, urlArg, method, at)) {
      noteIfUnreferenced(ctx, request.site);
      calls.push({ id: record(site, request.site, request.address, request.frames, request.choice), site: request.site.call });
    }
    consumersOf(site, method, owner, className, at.file, calls);
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const { declaration: method, body } of methodBodies(indexed.declaration)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;

      body.forEachDescendant((site, traversal) => {
        if (Node.isClassDeclaration(site) || Node.isClassExpression(site)) {
          traversal.skip();
          return;
        }
        if (!isEventSourceConstruction(site)) return;
        ctx.ensureMethodNode(method);
        emit(site, method, { call: site, methodId, file: indexed.file }, indexed.declaration, indexed.name);
      });
    }
  }
});
