import {
  applicationOfFile,
  jsDocCallsIn,
  makeChannelId,
  makeLeafId,
  makeSymbolId,
  methodsOfClass,
  normalizePath,
  siteOf,
  type ClassMethod,
  type GraphNode,
  type JsDocCall,
} from '@flowatlas/core';
import { ANGULAR_HTTP } from '../index-classes.js';
import { definePass } from './types.js';

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
 *
 * `@flowatlas-calls POST /orders` is the request a method makes, said outright;
 * `@flowatlas-calls catalog POST /orders` also says which service answers it
 * (P127). Both are read by the core's `jsDocCallsIn`, the one the server
 * readers read the same tag with.
 */
export const markersPass = definePass('markers', (ctx) => {
  /** The request already read from the source that says the same thing, when one does. */
  const alreadyStatic = (owner: GraphNode | undefined, method: string, path: string): GraphNode | undefined => {
    if (owner === undefined) return undefined;
    for (const edge of ctx.builder.edges) {
      if (edge.type !== 'calls' || edge.from !== owner.id) continue;
      const target = ctx.builder.getNode(edge.to);
      if (target?.type === 'ui_api_call' && target.meta?.['method'] === method && target.meta?.['path'] === path) {
        return target;
      }
    }
    return undefined;
  };

  const apiCall = (method: ClassMethod, written: JsDocCall, file: string, methodId: string): void => {
    const { method: verb, path, service } = written;
    const wanted = normalizePath(path);
    // A request read from the source says the same thing better. Where the
    // annotation also names the service, that much is still news: the address
    // was read and where it goes was not (P127).
    const read = alreadyStatic(ctx.builder.getNode(methodId), verb, wanted);
    if (read !== undefined) {
      if (service !== undefined) read.meta = { ...read.meta, service };
      return;
    }

    const at = siteOf(method);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    // With one base configured there is only one thing the address can be
    // rooted at, and saying so is what lets the annotation reach a service.
    const bases = ctx.service.apiBaseEnv ?? [];
    const baseUrlEnv = bases.length === 1 ? (bases[0] as string) : null;
    const application = applicationOfFile(ctx.meta, file);

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
        // Which application this request is written in, where the service holds
        // more than one; the other half of what an entry records about its own
        // address (R132).
        ...(application === undefined ? {} : { application }),
        // The service the annotation names, by name or alias: the linker asks
        // it before anything else (P127).
        ...(service === undefined ? {} : { service }),
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

      for (const written of jsDocCallsIn(docs)) {
        ctx.ensureMethodNode(method);
        apiCall(method, written, indexed.file, methodId);
      }
      for (const [, channelName] of docs.matchAll(CONSUMES)) {
        if (channelName === undefined) continue;
        ctx.ensureMethodNode(method);
        consumer(method, channelName, indexed.file, methodId, indexed.name);
      }
    }
  }
});
