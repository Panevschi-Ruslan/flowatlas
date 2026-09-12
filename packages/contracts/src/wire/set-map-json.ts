import type { TypeRefAst } from '@flowatlas/core';
import { withRule, type FieldView, type WireRule } from './rule.js';

/** `Set<T>` reads as `T[]`, `Map<K,V>` as `Record<K,V>`; anything else is left alone. */
const asJson = (ast: TypeRefAst): TypeRefAst | undefined => {
  if (ast.kind === 'array') {
    const element = asJson(ast.element);
    return element === undefined ? undefined : { kind: 'array', element };
  }
  if (ast.kind !== 'generic') return undefined;
  if (ast.name === 'Set' && ast.args.length === 1) {
    return { kind: 'array', element: ast.args[0] as TypeRefAst };
  }
  if (ast.name === 'Map' && ast.args.length === 2) {
    return { kind: 'generic', name: 'Record', args: ast.args };
  }
  return undefined;
};

/**
 * A set and a map do not survive JSON.
 *
 * `JSON.stringify(new Set([1]))` is `{}`, and so is a map. Whatever the two
 * declarations say, what actually arrives depends entirely on a replacer
 * somebody wrote by hand, so the honest answer is not "these agree" but "look
 * at this one" — a warning on the field even when both sides declare the same
 * thing (plan §3.3).
 *
 * The comparison itself continues against the shape a hand-written replacer
 * would most likely produce, so a genuine disagreement inside the set is still
 * named rather than lost behind the warning.
 */
export const setMapJson: WireRule = {
  id: 'set-map-json',
  describe: 'a Set or a Map does not survive JSON; whatever arrives was hand-written',
  normalise: (view) => {
    const type = asJson(view.type);
    if (type === undefined) return view;
    const next: FieldView = { ...view, type };
    return withRule(next, 'set-map-json');
  },
};
