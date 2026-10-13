import { instrument } from '@lending/telemetry';

export type Work<TEvent, TResult> = (event: TEvent, context?: unknown) => Promise<TResult>;

/**
 * Runs a handler inside a named span: the name first, the function second.
 *
 * The shape nearly every instrumented handler is written in, and the one a
 * reader that only looked at the first argument missed.
 */
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
 * A helper of this repository around a package nobody installed: it hands the
 * function to `instrument` and returns what that built, so it is no more
 * certain than `instrument` is.
 */
export const measured = <TEvent, TResult>(name: string, fn: Work<TEvent, TResult>): Work<TEvent, TResult> =>
  instrument(fn, { segment: name });

/** Answers from the first of two handlers that has an answer: handed two functions, so a wrapper of neither. */
export const firstOf =
  <TEvent, TResult>(primary: Work<TEvent, TResult | undefined>, fallback: Work<TEvent, TResult>): Work<TEvent, TResult> =>
  async (event, context) =>
    (await primary(event, context)) ?? fallback(event, context);
