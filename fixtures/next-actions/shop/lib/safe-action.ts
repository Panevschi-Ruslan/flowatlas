import { createSafeActionClient } from 'next-safe-action';

/**
 * The client every action in this repository is built with.
 *
 * One object, configured once, and then a chain per action. Nothing about the
 * chain is a function declaration, which is the whole of why the boundaries it
 * builds had to be described rather than looked for.
 */
export const actionClient = createSafeActionClient();

/** A helper of this repository's own, which no description names. */
export const withAudit = <T>(fn: T): T => fn;
