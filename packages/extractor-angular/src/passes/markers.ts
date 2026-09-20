import {
  makeChannelId,
  makeLeafId,
  makeSymbolId,
  methodsOfClass,
  normalizePath,
  siteOf,
  type ClassMethod,
  type GraphNode,
} from '@flowatlas/core';
import { ANGULAR_HTTP } from '../index-classes.js';
import { definePass } from './types.js';

/** `@flowatlas-calls POST /orders` — the request a method makes, said outright. */
const CALLS = /@flowatlas-calls\s+([A-Za-z]+)\s+(\S+)/g;

/** `@flowatlas-consumes order.updated` — the channel a method handles. */
const CONSUMES = /@flowatlas-consumes\s+(\S+)/g;

/** Everything written in the documentation comments of a method. */
const docsOf = (method: ClassMethod): string =>
  method
    .getJsDocs()
    .map((doc) => doc.getInnerText())
    .join('\n');

/**
 * Annotations, for the two things static reading cannot see.
 *
 * A request made through a client that takes its path as an argument has no
 * address at the call site, and a stream the browser subscribes to has no name
 * the checker can follow. Both are the reader's word rather than the compiler's,
 * so both land as `marker` and never as `static` (I10).
 */
export const markersPass = definePass('markers', (ctx) => {
  /** A request already read from the source says the same thing better. */
  const alreadyStatic = (owner: GraphNode | undefined, method: string, path: string): boolean =>
    owner !== undefined &&
    ctx.builder.edges.some((edge) => {
      if (edge.type !== 'calls' || edge.from !== owner.id) return false;
      const target = ctx.builder.getNode(edge.to);
      return (
        target?.type === 'ui_api_call' &&
        target.meta?.['method'] === method &&
        target.meta?.['path'] === path
      );
    });

  const apiCall = (
    method: ClassMethod,
    verb: string,
    path: string,
    file: string,
    methodId: string,
  ): void => {
    const wanted = normalizePath(path);
    if (alreadyStatic(ctx.builder.getNode(methodId), verb, wanted)) return;

    const at = siteOf(method);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    // With one base configured there is only one thing the address can be
    // rooted at, and saying so is what lets the annotation reach a service.
    const bases = ctx.service.apiBaseEnv ?? [];
    const baseUrlEnv = bases.length === 1 ? (bases[0] as string) : null;

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${verb} ${wanted}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'http',
      meta: {
        method: verb,
        url: wanted,
        path: wanted,
        baseUrlEnv,
        responseType: null,
        bodyType: null,
        package: ANGULAR_HTTP,
        via: 'marker',
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: id,
      type: 'calls',
      confidence: 'marker',
      file,
      line: at.line,
    });
  };

  const consumer = (
    method: ClassMethod,
    channelName: string,
    file: string,
    methodId: string,
    className: string,
  ): void => {
    const at = siteOf(method);
    const consumerId = `consumer:${makeSymbolId(ctx.repo, file, className, method.getName())}`;
    ctx.builder.addNode({
      id: consumerId,
      type: 'consumer',
      label: `${className}.${method.getName()}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'sse',
      meta: { kind: 'sse', adapter: 'marker', decorator: 'flowatlas-consumes', entryId: null },
    });
    ctx.builder.addEdge({
      from: consumerId,
      to: methodId,
      type: 'handles',
      confidence: 'marker',
      file,
      line: at.line,
    });

    const channelId = makeChannelId(channelName);
    ctx.builder.addNode({
      id: channelId,
      type: 'channel',
      label: channelName,
      repo: ctx.repo,
      file,
      line: at.line,
      meta: { channelKind: 'channel', adapters: ['marker'] },
    });
    ctx.builder.addEdge({
      from: channelId,
      to: consumerId,
      type: 'consumes',
      confidence: 'marker',
      file,
      line: at.line,
    });
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    // Every method, including the ones written as fields: the annotation is
    // what the hints tell somebody to write when an address cannot be read, and
    // a wrapper written as a field is exactly the case that needs it.
    for (const method of methodsOfClass(indexed.declaration)) {
      const docs = docsOf(method);
      if (docs === '') continue;
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;

      for (const [, verb, path] of docs.matchAll(CALLS)) {
        if (verb === undefined || path === undefined) continue;
        ctx.ensureMethodNode(method);
        apiCall(method, verb.toUpperCase(), path, indexed.file, methodId);
      }
      for (const [, channelName] of docs.matchAll(CONSUMES)) {
        if (channelName === undefined) continue;
        ctx.ensureMethodNode(method);
        consumer(method, channelName, indexed.file, methodId, indexed.name);
      }
    }
  }
});
