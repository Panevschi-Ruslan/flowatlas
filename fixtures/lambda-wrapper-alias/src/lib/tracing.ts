export type Work<TEvent, TResult> = (event: TEvent, context?: unknown) => Promise<TResult>;

/** Runs a handler inside a named span: the name first, the function second. */
export const traced =
  <TEvent, TResult>(name: string, fn: Work<TEvent, TResult>): Work<TEvent, TResult> =>
  async (event, context) => {
    const started = Date.now();
    try {
      return await fn(event, context);
    } finally {
      console.log(JSON.stringify({ span: name, ms: Date.now() - started }));
    }
  };

/** Retries a handler: options first, the function second. */
export function withRetry<TEvent, TResult>(options: { attempts: number }, fn: Work<TEvent, TResult>): Work<TEvent, TResult> {
  return async (event, context) => {
    let failure: unknown;
    for (let attempt = 0; attempt < options.attempts; attempt += 1) {
      try {
        const result = await fn(event, context);
        return result;
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  };
}

/**
 * Not a wrapper: a factory that builds its own handler and only uses the
 * function it is given to look a borrower up. Called by another name, it is
 * still not one.
 */
export const listing =
  <TEvent>(lookup: (id: string) => Promise<string | undefined>): Work<TEvent, { name: string }> =>
  async () => ({ name: (await lookup('desk')) ?? 'unknown' });
