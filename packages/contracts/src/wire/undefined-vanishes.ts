import { withRule, type FieldView, type WireRule } from './rule.js';

/** `null` survives JSON and `undefined` does not; only the second is dropped. */
const isUndefined = (ast: { kind: string; name?: string }): boolean =>
  ast.kind === 'primitive' && ast.name === 'undefined';

/**
 * A field holding nothing is not written at all.
 *
 * `JSON.stringify` leaves out a property whose value is `undefined`, so a
 * sender that types a field `T | undefined` may or may not send it, whatever
 * the question mark says. That is optionality, not a missing field, and the
 * difference decides whether the reader sees an error or a warning.
 */
export const undefinedVanishes: WireRule = {
  id: 'undefined-vanishes',
  describe: 'an undefined field is left out of the JSON entirely',
  normalise: (view, side) => {
    if (isUndefined(view.type)) {
      // Nothing else is in there, so nothing is ever written. On the receiving
      // side the declaration is degenerate rather than absent, and saying so is
      // the comparator's job, not this rule's.
      return side === 'sender'
        ? withRule({ ...view, dropped: true }, 'undefined-vanishes')
        : view;
    }
    if (view.type.kind !== 'union') return view;
    const members = view.type.members.filter((member) => !isUndefined(member));
    if (members.length === view.type.members.length) return view;

    const next: FieldView = {
      ...view,
      type: members.length === 1 ? (members[0] as FieldView['type']) : { kind: 'union', members },
      optional: true,
      optionalBy: view.optionalBy ?? 'undefined-union',
    };
    return withRule(next, 'undefined-vanishes');
  },
};
