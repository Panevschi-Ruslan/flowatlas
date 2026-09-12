/**
 * One pair of fields, run through the comparator.
 *
 * A rule is only worth having if it changes what the comparator says, so every
 * rule is tested through the comparator rather than by inspecting the view it
 * produced. Each case is "the caller declares this, the receiver declares that,
 * and here is what a reader should be told".
 */
import type { TypeField, TypeRegistry } from '@flowatlas/core';
import { compareTypes, diffTypes } from '../compare.js';
import type { FieldDiff } from '../types.js';
import { object } from '../test-graph.js';

export interface Pair {
  sent: TypeField;
  expected: TypeField;
  registry?: TypeRegistry;
  /** Rules to switch off, for the case that proves the rule is what did it. */
  disableRules?: readonly string[];
}

/** Everything the comparator says about one pair of fields. */
export const compareField = (pair: Pair): FieldDiff[] => {
  const registry = pair.registry ?? {};
  const sender = object('Sent', [pair.sent], registry);
  const receiver = object('Expected', [pair.expected], registry);
  return compareTypes(sender, receiver, registry, {
    ...(pair.disableRules === undefined ? {} : { disableRules: pair.disableRules }),
  });
};

/** The rules that fired on one pair, with the path each fired at. */
export const rulesFor = (pair: Pair): string[] => {
  const registry = pair.registry ?? {};
  const sender = object('Sent', [pair.sent], registry);
  const receiver = object('Expected', [pair.expected], registry);
  return diffTypes(sender, receiver, (id) => registry[id], {
    ...(pair.disableRules === undefined ? {} : { disableRules: pair.disableRules }),
  }).rulesApplied;
};
