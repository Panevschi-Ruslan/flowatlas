/**
 * Which package and which class the source says a receiver is, when the checker
 * cannot say. Moved to the core (P121), where a described HTTP client is matched
 * by the same reading a described bus is; re-exported here for the readers that
 * import it from this package.
 */
export { importOf, statedOrigin, type StatedOrigin } from '@flowatlas/core';
