/**
 * The scope walk, which used to be written here.
 *
 * It was put in this package because it is stated in terms of a context, a
 * class index and `methodBodies`, and both adapter packages already depended on
 * this package for those. That was true and it was still the wrong address: the
 * Angular reader resolves channel names with the broker adapter's functions, so
 * it depends on that package, so through this one sentence it depended on the
 * Nest extractor and could not be built without it. Two siblings neither of
 * which should be able to name the other were naming each other through a
 * shared walk (R46).
 *
 * So the walk moved to `@flowatlas/extract-scopes`, which neither extractor
 * owns, and is written against the questions any extractor can answer rather
 * than against `NestExtractContext`. This file stays as the name it had,
 * because every caller in this repository and every caller outside it asked
 * this package for it, and a move is not a reason to make them all say
 * something new.
 */
export { repoSourceFiles, scopesOf, WALKED_ROLES } from '@flowatlas/extract-scopes';
export type { Holder, Scope } from '@flowatlas/extract-scopes';
