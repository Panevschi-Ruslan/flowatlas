import { RXJS_DECLARATION_SHAPE, type DeclarationShape } from '@flowatlas/core';
import { ANGULAR_CORE_SHAPE } from './angular-core.js';
import { ANGULAR_HTTP_SHAPE } from './angular-http.js';

/**
 * The packages this reader carries a shape of, read only where the repository
 * has not installed them (see `installDeclarationShapes` in the core).
 *
 * An Angular application is written against these three whatever else it
 * uses, and an uninstalled clone loses the most through them: the decorators
 * and injection a class is wired by, the client every request is made with,
 * and the stream it answers with. The stream library's shape is the one the
 * server reader carries too. The real package always wins.
 */
export const ANGULAR_SHAPES: readonly DeclarationShape[] = Object.freeze([
  RXJS_DECLARATION_SHAPE,
  { package: '@angular/core', declarations: ANGULAR_CORE_SHAPE },
  { package: '@angular/common/http', declarations: ANGULAR_HTTP_SHAPE },
]);
