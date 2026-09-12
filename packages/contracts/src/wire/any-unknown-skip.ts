import { withRule, type WireRule } from './rule.js';

/**
 * A field typed `any` or `unknown` says nothing, so nothing is checked.
 *
 * Comparing it against anything at all would be inventing a claim neither side
 * made. The field is still known to be there — only its shape is not — so a
 * receiver that requires it is satisfied and a mismatch is never reported.
 */
export const anyUnknownSkip: WireRule = {
  id: 'any-unknown-skip',
  describe: 'a field typed any or unknown carries no claim to compare',
  normalise: (view) => {
    if (view.type.kind !== 'primitive') return view;
    if (view.type.name !== 'any' && view.type.name !== 'unknown') return view;
    return withRule({ ...view, opaque: true }, 'any-unknown-skip');
  },
};
