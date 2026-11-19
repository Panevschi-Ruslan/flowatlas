/** The codes Windows gives while another process holds a file open or is replacing it. */
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Runs a change to a file, waiting briefly while another process holds it.
 *
 * On Windows a file open in another process cannot be renamed over or removed,
 * and two processes renaming onto one name at once fail the same way. Each
 * race lasts milliseconds, so giving up at once would fail the caller for it
 * (P199). Any other error, and the last attempt's, is thrown as it was.
 */
export const whenFree = <T>(change: () => T, attempts = 20): T => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return change();
    } catch (cause) {
      if (attempt >= attempts || !HELD.has(String((cause as NodeJS.ErrnoException).code))) throw cause;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
};
