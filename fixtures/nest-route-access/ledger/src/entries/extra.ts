/** Filled at run time, so nothing here can list what it returns. */
const registered = new Set<unknown>();

/** Built at run time, so nothing here can list what it returns. */
export const extraProviders = (): unknown[] => Array.from(registered);
