/**
 * Everything JSON does to a shape, in the order it does it.
 *
 * Order matters and is the only thing this file decides. An annotation runs
 * first, because it can drop a field before anything else bothers to read its
 * type. Vanishing runs next, because it decides optionality, which the type
 * substitutions must not disturb. The substitutions follow. Collections come
 * after them, so `Set<Date>` is already `Set<string>` by the time it becomes an
 * array. Opacity is last, so a rule that produced `unknown` is still counted.
 */
import { parseTypeRef, type TypeField } from '@flowatlas/core';
import type { Side } from '../types.js';
import { anyUnknownSkip } from './any-unknown-skip.js';
import { bigintString } from './bigint-string.js';
import { bufferString } from './buffer-string.js';
import { classTransformer } from './class-transformer.js';
import { dateString } from './date-string.js';
import { objectidString } from './objectid-string.js';
import { optionalAcceptsNull } from './optional-accepts-null.js';
import type { FieldView, WireRule } from './rule.js';
import { setMapJson } from './set-map-json.js';
import { undefinedVanishes } from './undefined-vanishes.js';

export const WIRE_RULES: readonly WireRule[] = [
  classTransformer,
  undefinedVanishes,
  optionalAcceptsNull,
  dateString,
  bigintString,
  bufferString,
  objectidString,
  setMapJson,
  anyUnknownSkip,
];

export interface WireOptions {
  /** Rule ids to switch off, from `contracts.rules.disable`. */
  disable?: readonly string[];
  /** The rules to run. Defaults to all of them, in the order above. */
  rules?: readonly WireRule[];
}

/**
 * A reference the extractor could not write as a type, kept as it stands.
 *
 * The registry's grammar covers everything the extractor writes, so a parse
 * failure means a reference from somewhere else. Reading it as an opaque name
 * loses nothing a comparison would have used, and is better than throwing in
 * the middle of a report.
 */
const parse = (ref: string): FieldView['type'] => {
  try {
    return parseTypeRef(ref);
  } catch {
    return { kind: 'primitive', name: ref };
  }
};

/** The declaration, before any rule has had a say. */
export const viewOf = (field: TypeField): FieldView => {
  const optionalBy = field.meta?.['optionalBy'];
  return {
    name: field.name,
    declaredName: field.name,
    type: parse(field.type),
    declared: field.type,
    optional: field.optional,
    ...(typeof optionalBy === 'string' ? { optionalBy } : {}),
    dropped: false,
    opaque: false,
    meta: field.meta ?? {},
    rules: [],
  };
};

/**
 * One field, as the wire will carry it from this side.
 *
 * `side` matters because the two ends do not run the same rules over the same
 * data: the sender serialises and the receiver parses, so a field that only
 * ever holds nothing disappears from one and stays a broken declaration on the
 * other.
 */
export const applyWireRules = (
  field: TypeField,
  side: Side,
  options: WireOptions = {},
): FieldView => {
  const disabled = new Set(options.disable ?? []);
  let view = viewOf(field);
  for (const rule of options.rules ?? WIRE_RULES) {
    if (disabled.has(rule.id)) continue;
    view = rule.normalise(view, side);
  }
  return view;
};

export {
  anyUnknownSkip,
  bigintString,
  bufferString,
  classTransformer,
  dateString,
  objectidString,
  optionalAcceptsNull,
  setMapJson,
  undefinedVanishes,
};
export type { FieldView, WireRule } from './rule.js';
