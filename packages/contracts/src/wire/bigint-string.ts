import { changed, rename, withRule, type WireRule } from './rule.js';

/**
 * A big integer is a string once it is JSON.
 *
 * There is no other choice: JSON has one number type and it cannot hold one, so
 * every serialiser that supports the type at all writes it out as text.
 */
export const bigintString: WireRule = {
  id: 'bigint-string',
  describe: 'a bigint is serialised as a string',
  normalise: (view) => {
    const type = rename(view.type, 'bigint', 'string');
    return changed(view.type, type) ? withRule({ ...view, type }, 'bigint-string') : view;
  },
};
