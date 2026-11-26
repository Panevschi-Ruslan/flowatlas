/** What the ledger reads from its environment when the module is imported. */
export const settings = {
  // Renamed on one side: the compose file sets LEDGER_ZONE.
  ledgerRegion: process.env.LEDGER_REGION as string,
  // Set, and read: nothing to say.
  paymentProvider: process.env.PAYMENT_PROVIDER as string,
  // Set nowhere; the cache's password is set, but a host and a password are two settings, not one renamed.
  cacheHost: process.env.CACHE_HOST as string,
  port: Number(process.env.PORT ?? 3000),
};
