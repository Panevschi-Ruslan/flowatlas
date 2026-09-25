import { definePass } from './types.js';

/**
 * Gives every screen a node, whether or not anything reaches it.
 *
 * Every other node this extractor makes is made lazily, by the pass that draws
 * the first edge to it — which is right for a hook and for a module function,
 * because one nothing calls and that calls nothing says nothing about the
 * shape of the system.
 *
 * A screen is the exception, and it is the exception for the same reason the
 * whole reader exists. A screen with no request on it is not noise: it is a
 * page of this application, and a person asking what the front end consists of
 * wants it listed. Leaving it out would also make the answer depend on the
 * order the passes happen to run in, since a component gains a node the moment
 * anything at all touches it.
 */
export const functionsPass = definePass('functions', (ctx) => {
  for (const indexed of ctx.functions.all()) {
    if (indexed.role === 'component') ctx.ensureFunctionNode(indexed.fn);
  }
});
