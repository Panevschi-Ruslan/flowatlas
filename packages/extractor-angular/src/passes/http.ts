import {
  declaredParameterType,
  evaluateExpression,
  forEachCall,
  makeExternalApiId,
  makeLeafId,
  narrowUnionByLiteral,
  resolveTypeOrigin,
  siteOf,
  type TypeOrigin,
} from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { ANGULAR_HTTP } from '../index-classes.js';
import { analyzeApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/** What each method of the client sends, and where it writes the address. */
const VERBS: Record<string, { method: string; urlIndex: number; bodyIndex: number | null }> = {
  get: { method: 'GET', urlIndex: 0, bodyIndex: null },
  post: { method: 'POST', urlIndex: 0, bodyIndex: 1 },
  put: { method: 'PUT', urlIndex: 0, bodyIndex: 1 },
  patch: { method: 'PATCH', urlIndex: 0, bodyIndex: 1 },
  delete: { method: 'DELETE', urlIndex: 0, bodyIndex: null },
  head: { method: 'HEAD', urlIndex: 0, bodyIndex: null },
  options: { method: 'OPTIONS', urlIndex: 0, bodyIndex: null },
  jsonp: { method: 'GET', urlIndex: 0, bodyIndex: null },
  // The verb of a generic request is its first argument, not its name.
  request: { method: '', urlIndex: 1, bodyIndex: null },
};

/**
 * Whether a call is made on the framework's HTTP client.
 *
 * The subpath the client is imported from is not the package it belongs to, so
 * both spellings are accepted; the type name is what actually decides.
 */
const isHttpClient = (origin: TypeOrigin | null): boolean =>
  origin?.typeName === 'HttpClient' &&
  (origin.package === '@angular/common' || origin.package === ANGULAR_HTTP);

/**
 * Requests the browser makes.
 *
 * This is where Angular pays for itself: the address, the verb and the type of
 * the answer are all written at one call site, so a node here carries everything
 * the linker needs to join it to the route that serves it and everything P10
 * needs to compare the two sides of that boundary.
 */
export const httpPass = definePass('http', (ctx: AngularExtractContext) => {
  const sharedPackages = ctx.config.sharedPackages;
  const apiBaseEnv = ctx.service.apiBaseEnv ?? [];

  const verbOf = (call: CallExpression, name: string): string | null => {
    const shape = VERBS[name];
    if (shape === undefined) return null;
    if (shape.method !== '') return shape.method;
    const [written] = call.getArguments();
    const value = written === undefined ? undefined : evaluateExpression(written);
    return value?.resolved === true && typeof value.value === 'string'
      ? value.value.toUpperCase()
      : null;
  };

  const typeOfResponse = (call: CallExpression): string | null => {
    const [written] = call.getTypeArguments();
    if (written !== undefined) return ctx.types.collectType(written.getType(), call);
    const returned = ctx.types.unwrapAsync(call.getReturnType());
    if (returned.isAny() || returned.isUnknown() || returned.isVoid()) return null;
    return ctx.types.collectType(returned, call);
  };

  const typeOfBody = (call: CallExpression, index: number | null): string | null => {
    if (index === null) return null;
    const argument = call.getArguments()[index];
    if (argument === undefined) return null;
    const declared = declaredParameterType(call, index, ctx.checker);
    const narrowed = declared === undefined ? undefined : narrowUnionByLiteral(declared, argument);
    return ctx.types.collectType(narrowed ?? argument.getType(), argument);
  };

  const record = (call: CallExpression, name: string, methodId: string, file: string): void => {
    const shape = VERBS[name];
    if (shape === undefined) return;
    const urlArg = call.getArguments()[shape.urlIndex];
    if (urlArg === undefined) return;

    const verb = verbOf(call, name);
    const address = analyzeApiUrl(urlArg, sharedPackages);
    const at = siteOf(call);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const responseType = typeOfResponse(call);
    const bodyType = typeOfBody(call, shape.bodyIndex);

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
        package: ANGULAR_HTTP,
        via: address.via,
        ...(address.host === null ? {} : { host: address.host }),
        // Only ever set, never set to false: it is a mark on the few addresses
        // a branch was guessed for, and the linker lowers the edge it draws
        // from one. Everything without it was read outright.
        ...(address.guessed ? { guessed: true } : {}),
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

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    for (const method of indexed.declaration.getMethods()) {
      const body = method.getBody();
      if (body === undefined) continue;
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;

      forEachCall(body, (site: TsNode) => {
        if (!Node.isCallExpression(site)) return;
        const callee = site.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const name = callee.getName().toLowerCase();
        if (!Object.hasOwn(VERBS, name)) return;
        if (!isHttpClient(resolveTypeOrigin(callee.getExpression()))) return;
        ctx.ensureMethodNode(method);
        record(site, name, methodId, indexed.file);
      });
    }
  }
});
