/**
 * Code the framework calls by itself (P399): a lifecycle hook of a class the
 * framework builds - a provider's `onModuleInit` a module registers - runs
 * when the application starts or stops, with no caller in the code. Without
 * saying so, a method such a hook calls (`setup()`, registering a bot's
 * handlers) was the end of a chain nothing read reaches, a `maybe`.
 *
 * A reader that knows which hooks its framework calls, and on which classes,
 * writes {@link FRAMEWORK_CALLS_META} on the hook's node: `{ hook, when }`.
 * What answers reach (`dead`, the ways in a walk back meets) reads it as a
 * way in of its own, said `startup (onModuleInit)`. Nothing here knows any
 * framework's hook names.
 */
import type { GraphNode } from './model/nodes.js';

/** On a method: the framework calls it by itself, `{ hook, when }`. */
export const FRAMEWORK_CALLS_META = 'frameworkCalls';

/** When the framework calls a hook. */
export type FrameworkCallTime = 'startup' | 'shutdown';

/** A hook the framework calls: its name, and when. */
export interface FrameworkCall {
  readonly hook: string;
  readonly when: FrameworkCallTime;
}

/** The framework call a node's meta records, when it records one. */
export const frameworkCallOf = (node: Pick<GraphNode, 'meta'> | undefined): FrameworkCall | undefined => {
  const value = node?.meta?.[FRAMEWORK_CALLS_META];
  if (typeof value !== 'object' || value === null) return undefined;
  const { hook, when } = value as Record<string, unknown>;
  return typeof hook === 'string' && (when === 'startup' || when === 'shutdown') ? { hook, when } : undefined;
};

/** A framework call as a way in says it: `startup (onModuleInit)`. */
export const frameworkCallSaid = (call: FrameworkCall): string => `${call.when} (${call.hook})`;
