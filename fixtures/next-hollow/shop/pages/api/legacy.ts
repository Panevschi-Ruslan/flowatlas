import { legacyHandler } from '../../lib/rest';

/**
 * The older router's shape of the same hole.
 *
 * One file answers every verb from its default export, and here that export is a
 * value a call built elsewhere. The file is a way in at `/api/legacy` and nothing
 * behind it was read.
 */
export default legacyHandler;
