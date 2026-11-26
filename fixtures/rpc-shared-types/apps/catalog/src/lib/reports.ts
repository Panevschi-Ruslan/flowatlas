import { os } from '@orpc/server';

/** The reports branch, loaded lazily by the catalog's tree. */
export default {
  daily: os.handler(async () => ({ total: 0 })),
};
