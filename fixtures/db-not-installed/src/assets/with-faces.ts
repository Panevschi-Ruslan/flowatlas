import type { ExpressionBuilder } from 'kysely';

import type { DB } from './schema.js';

/**
 * A data layer that is a function rather than a class, whose receiver is a
 * parameter of the library's own builder type.
 *
 * This is immich's `server/src/utils/database.ts`, where 28 sites name real
 * tables this way. R52 made the walk read functions as well as methods, so the
 * body is visited; what stopped the read here is the same thing that stopped it
 * in a class - the parameter's type comes out of a package nobody installed -
 * and the annotation beside it is the answer in both places.
 */
export const withFaces = (eb: ExpressionBuilder<DB, 'asset'>): unknown =>
  eb.selectFrom('asset_face').selectAll().execute();
