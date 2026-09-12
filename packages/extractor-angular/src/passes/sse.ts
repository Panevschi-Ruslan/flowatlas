import { makeExternalApiId, makeLeafId, originOfValue, siteOf } from '@flowatlas/core';
import type { NewExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { analyzeApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/** The browser's own client for a stream of server-sent events. */
const CLIENT = 'EventSource';

/**
 * Whether this `EventSource` is the browser's.
 *
 * The name alone proves nothing — a repository is free to declare a class of its
 * own by that name, and one that did would be something else entirely. What
 * decides is where the name was declared: the language's own library, or a
 * package standing in for it where the browser has none. A class declared in the
 * repository is rejected. A name the checker will not resolve at all is accepted,
 * because there is then no declaration for it to have missed: it is the ambient
 * global in a repository whose compiler settings leave the browser's library out.
 */
const isBrowserClient = (expression: TsNode): boolean => {
  if (!Node.isIdentifier(expression) || expression.getText() !== CLIENT) return false;
  return originOfValue(expression).kind !== 'local';
};

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
 */
export const ssePass = definePass('sse', (ctx: AngularExtractContext) => {
  const sharedPackages = ctx.config.sharedPackages;
  const apiBaseEnv = ctx.service.apiBaseEnv ?? [];

  const record = (site: NewExpression, methodId: string, file: string): void => {
    const [urlArg] = site.getArguments();
    if (urlArg === undefined) return;

    const address = analyzeApiUrl(urlArg, sharedPackages);
    const at = siteOf(site);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);

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
        via: address.via,
        ...(address.host === null ? {} : { host: address.host }),
        ...(address.guessed ? { guessed: true } : {}),
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
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const method of indexed.declaration.getMethods()) {
      const body = method.getBody();
      if (body === undefined) continue;
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;

      body.forEachDescendant((site, traversal) => {
        if (Node.isClassDeclaration(site) || Node.isClassExpression(site)) {
          traversal.skip();
          return;
        }
        if (!Node.isNewExpression(site)) return;
        if (!isBrowserClient(site.getExpression())) return;
        ctx.ensureMethodNode(method);
        record(site, methodId, indexed.file);
      });
    }
  }
});
