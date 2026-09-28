import { LegacyController } from './legacy.controller';

/**
 * The list a module spreads instead of writing out.
 *
 * A photo server's shape: `controllers: [...controllers]`, where the array is assembled
 * in another file. Nothing static resolves a spread element to a class, so the
 * module reads as declaring no controllers at all.
 */
export const legacyControllers = [LegacyController];
