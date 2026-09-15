import type { TypeRefAst } from '@flowatlas/core';
import { withRule, type WireRule } from './rule.js';

const isNull = (ast: TypeRefAst): boolean =>
  (ast.kind === 'primitive' && ast.name === 'null') ||
  (ast.kind === 'literal' && ast.value === null);

/**
 * A validator that skips a missing value skips a `null` one too.
 *
 * `@IsOptional()` passes a field whose value is `null` or `undefined` without
 * running any other validator on it, so a receiver declaring `notes?: string`
 * under it reads `null` without complaint. A sender that writes `null` there is
 * not breaking anything, and saying it does was most of what a report over a
 * validated API said about nullable fields.
 *
 * Receiver side only: it widens what is accepted, never what is sent.
 */
export const optionalAcceptsNull: WireRule = {
  id: 'optional-accepts-null',
  describe: 'a field the receiving validator marks optional accepts null as well as nothing',
  normalise: (view, side) => {
    if (side !== 'receiver') return view;
    const validators = view.meta['validators'];
    const skipsEmpty =
      view.optionalBy === 'IsOptional' ||
      (Array.isArray(validators) && validators.includes('IsOptional'));
    if (!skipsEmpty) return view;
    const members = view.type.kind === 'union' ? view.type.members : [view.type];
    if (members.some(isNull)) return view;
    const type: TypeRefAst = {
      kind: 'union',
      members: [...members, { kind: 'primitive', name: 'null' }],
    };
    return withRule({ ...view, type }, 'optional-accepts-null');
  },
};
