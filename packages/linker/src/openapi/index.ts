/**
 * Reading a service the project cannot read, from the document that declares it.
 *
 * It sits in the linker rather than beside the extractors because it reads no
 * source: there is no program to type-check, no framework to detect and no
 * repository to open. What it does is produce the same graph a repository would
 * have produced, so that the join two files over has two ends to work with.
 */
export { OPERATION_VERBS, openapiDocumentSchema } from './document.js';
export type { OpenapiDocument, Operation } from './document.js';
export { readOpenapiDocument } from './read.js';
