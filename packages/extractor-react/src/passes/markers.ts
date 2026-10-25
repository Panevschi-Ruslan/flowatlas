import {
  applicationOfFile,
  docsAbove,
  jsDocCallsIn,
  makeLeafId,
  normalizePath,
  siteOf,
  type GraphNode,
  type JsDocCall,
} from '@flowatlas/core';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/**
 * `/** @flowatlas-calls GET /items *\/` above a function: the request it makes,
 * said outright, and with a service written first,
 * `@flowatlas-calls catalog GET /items`, which service answers it (P127).
 *
 * The hints on an address or a verb this reader could not read say to write
 * it, so this is where it is read. The same tag the Angular and server readers
 * read, through the same `jsDocCallsIn`, and like theirs the reader's word
 * rather than the compiler's: `marker`, never `static` (I10).
 */
export const markersPass = definePass('markers', (ctx) => {
  /** The request already read in the function that says the same thing, when one does. */
  const alreadyRead = (owner: string, method: string, path: string): GraphNode | undefined => {
    for (const edge of ctx.builder.edges) {
      if (edge.type !== 'calls' || edge.from !== owner) continue;
      const target = ctx.builder.getNode(edge.to);
      if (target?.type === 'ui_api_call' && target.meta?.['method'] === method && target.meta?.['path'] === path) {
        return target;
      }
    }
    return undefined;
  };

  const apiCall = (indexed: IndexedFunction, written: JsDocCall): void => {
    const { method, service } = written;
    const path = normalizePath(written.path);
    // A request read from the source says the same thing better; where the
    // annotation names the service, that much is still news.
    const read = alreadyRead(indexed.id, method, path);
    if (read !== undefined) {
      if (service !== undefined) read.meta = { ...read.meta, service };
      return;
    }

    const at = siteOf(indexed.fn.declaration);
    const id = makeLeafId('ui_api_call', ctx.repo, indexed.file, at.line, at.column);
    // With one base configured there is only one thing the address can be
    // rooted at, and saying so is what lets the annotation reach a service.
    const bases = ctx.service.apiBaseEnv ?? [];
    const application = applicationOfFile(ctx.meta, indexed.file);
    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `${method} ${path}`,
      repo: ctx.repo,
      file: indexed.file,
      line: at.line,
      kind: 'http',
      meta: {
        method,
        url: path,
        path,
        baseUrlEnv: bases.length === 1 ? (bases[0] as string) : null,
        responseType: null,
        bodyType: null,
        package: null,
        ...(application === undefined ? {} : { application }),
        ...(service === undefined ? {} : { service }),
        via: 'marker',
      },
    });
    ctx.builder.addEdge({
      from: indexed.id,
      to: id,
      type: 'calls',
      confidence: 'marker',
      file: indexed.file,
      line: at.line,
    });
  };

  for (const indexed of ctx.functions.all()) {
    const written = jsDocCallsIn(docsAbove(indexed.fn.declaration));
    if (written.length === 0) continue;
    ctx.ensureFunctionNode(indexed.fn);
    for (const call of written) apiCall(indexed, call);
  }
});
