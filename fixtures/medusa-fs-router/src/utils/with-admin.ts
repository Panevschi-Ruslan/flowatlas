/**
 * A wrapper this repository writes round its own handlers.
 *
 * A verb exported as the value of a call of this is read in full, because the
 * work was written inside the call. A verb exported as the value of a call that
 * was handed nothing declared here is not, and `hooks/[provider]/route.ts` is
 * the other side of that distinction.
 */
export const withAdmin = <T extends (...args: never[]) => unknown>(handler: T): T => handler;
