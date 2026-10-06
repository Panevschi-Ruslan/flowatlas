import { makeEntryReference, makeInvokeEntryKey, makeWorkflowEntryKey } from '@flowatlas/core';

/**
 * How a step names the entry it reaches when all it knows is a deployed name.
 *
 * A step that starts another workflow or invokes a function names it, and the
 * thing it names may be declared in any service of the project, or in none.
 * So the step does not draw an edge. It records a reference - the entry's kind
 * and key with no service - and the linker, which sees every service at once,
 * joins it to the one entry whose id ends in it, the way a channel is joined
 * by its name. Both functions here build the key with the same helper the
 * entry's own id is built with, so the two sides cannot spell a name
 * differently.
 */

/** The reference a step that starts a workflow carries. */
export const workflowReference = (name: string): string =>
  makeEntryReference('workflow', makeWorkflowEntryKey(name));

/** The reference a step that invokes a function carries. */
export const functionReference = (name: string): string =>
  makeEntryReference('invoke', makeInvokeEntryKey(name));
