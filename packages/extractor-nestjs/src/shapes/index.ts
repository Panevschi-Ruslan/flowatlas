import type { DeclarationShape } from '@flowatlas/core';
import { NEST_COMMON_SHAPE } from './nest-common.js';
import { NEST_CORE_SHAPE } from './nest-core.js';
import { NEST_MICROSERVICES_SHAPE } from './nest-microservices.js';
import { RXJS_SHAPE } from './rxjs.js';

/**
 * The packages this reader carries a shape of, read only where the repository
 * has not installed them (see `installDeclarationShapes` in the core).
 *
 * A Nest service is written against these four whatever else it uses, and an
 * uninstalled clone of one loses the most through them: the module and handler
 * decorators, the client a token is registered as, and the stream every client
 * and HTTP call answers with. Each shape is a few declarations written by hand,
 * never a copy of the library, and the real package always wins.
 */
export const NEST_SHAPES: readonly DeclarationShape[] = Object.freeze([
  { package: 'rxjs', declarations: RXJS_SHAPE },
  { package: '@nestjs/common', declarations: NEST_COMMON_SHAPE },
  { package: '@nestjs/core', declarations: NEST_CORE_SHAPE },
  { package: '@nestjs/microservices', declarations: NEST_MICROSERVICES_SHAPE },
]);
