import { batchHandler } from '@lending/batch';

/**
 * Reads the loans-opened queue into the archive table. The function that runs
 * is the one `batchHandler` builds, inside a package that is not installed, so
 * nothing here says what it does.
 */
export const archiveLoan = batchHandler({ table: 'library-desk-loan-archive', batchSize: 25 });
