/**
 * The altitude between the core and the extractors.
 *
 * Two things live here and they belong together. One is the shape of what an
 * extractor hands a pass: which classes it indexed, which functions an entry
 * point named, how to turn a declaration into an id and a node. The other is
 * the walk over the bodies of a repository, which is written in terms of that
 * shape and nothing else.
 *
 * Neither is a framework and neither is technology-free enough for the core,
 * which is exactly why they need an address of their own: without one, whoever
 * wrote them first owned them, and every package that needed them inherited
 * that package's whole dependency list along with them (R46).
 */
export const PACKAGE_NAME = '@flowatlas/extract-scopes';

export type { EntryLike, PassContext, ScopeContext } from './context.js';
export { repoSourceFiles, scopesOf, WALKED_ROLES } from './scopes.js';
export type { Holder, Scope } from './scopes.js';
