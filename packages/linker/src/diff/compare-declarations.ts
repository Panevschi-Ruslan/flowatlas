/**
 * Two declarations of one type, one revision apart.
 *
 * The comparison itself is `@flowatlas/contracts`', deliberately: a field JSON
 * drops on the way through is not a change to the wire, and `diff` must decide
 * that the same way `contracts` does or a report will name a break the checker
 * will not. What is added here is only the wording, because the two ends are a
 * revision rather than two services and "sender gateway" would be nonsense.
 */
import { compareTypes, type FieldDiff } from '@flowatlas/contracts';
import type { TypeEntry, TypeRegistry } from '@flowatlas/core';
import type { TypeFieldChange, TypeFieldChangeKind } from './types.js';

const CHANGE: Record<FieldDiff['kind'], TypeFieldChangeKind> = {
  missing_required: 'added',
  extra_field: 'removed',
  type_mismatch: 'type',
  optionality_mismatch: 'optionality',
};

/** `` `items[].price` ``, or `the whole shape` at the top of the type. */
const named = (field: string): string => (field === '' ? 'the whole shape' : `\`${field}\``);

const shown = (type: string | null): string => (type === null ? 'nothing' : `\`${type}\``);

/**
 * What the change reads as, in the two words this report has for the ends.
 *
 * A field that appeared and is required is the sentence a reviewer needs to see
 * first, which is why it says so rather than saying "the receiver requires".
 */
const sentence = (diff: FieldDiff, optional: boolean): string => {
  switch (diff.kind) {
    case 'missing_required':
      return `head declares ${named(diff.path)} as ${shown(diff.expected)} and requires it; base did not send it`;
    case 'extra_field':
      return `base sent ${named(diff.path)} as ${shown(diff.actual)}; head declares no such field`;
    case 'optionality_mismatch':
      return optional
        ? `${named(diff.path)} was required in base and may be left out in head`
        : `${named(diff.path)} could be left out in base and is required in head`;
    default:
      return `${named(diff.path)} was ${shown(diff.actual)} in base and is ${shown(diff.expected)} in head`;
  }
};

export interface DeclarationCompareOptions {
  depth?: number;
  disableRules?: readonly string[];
}

/**
 * The field-level difference between one type's two declarations.
 *
 * Read as a data flow from base to head — what a revision at base would send
 * into what the head declares — which is exactly the question a reviewer is
 * asking: does what already exists still fit what this branch expects?
 */
export const compareDeclarations = (
  base: TypeEntry,
  head: TypeEntry,
  registry: TypeRegistry,
  options: DeclarationCompareOptions = {},
): TypeFieldChange[] =>
  compareTypes(base, head, registry, {
    ...(options.depth === undefined ? {} : { depth: options.depth }),
    ...(options.disableRules === undefined ? {} : { disableRules: options.disableRules }),
  }).map((diff) => {
    // `optionalOn` names the end that may leave the field out, and the head is
    // the receiving end of this comparison.
    const optional = diff.optionalOn === 'receiver';
    return {
      field: diff.path,
      change: CHANGE[diff.kind],
      optional,
      base: diff.actual,
      head: diff.expected,
      rule: diff.rule,
      message: sentence(diff, optional),
    };
  });
