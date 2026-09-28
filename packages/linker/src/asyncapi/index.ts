/**
 * Reading a service the project cannot read, from an AsyncAPI document.
 *
 * Beside the OpenAPI reader rather than under it: the two are siblings, sharing
 * the decisions in `../document/` and nothing else. It reads no source, so it
 * sits in the linker for the same reason that one does — there is no program to
 * type-check, no framework to detect and no repository to open, only a graph to
 * produce so that the join has two ends to work with.
 */
export { CHANNEL_ENDS, asyncapiDocumentSchema } from './document.js';
export type { AsyncapiDocument, AsyncapiMessage, ChannelEnd } from './document.js';
export { readAsyncapiDocument } from './read.js';
