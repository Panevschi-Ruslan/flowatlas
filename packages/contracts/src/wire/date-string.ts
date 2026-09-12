import { changed, rename, withRule, type WireRule } from './rule.js';

/**
 * A date is a string once it is JSON.
 *
 * The most common false alarm there is: one repository types a timestamp as a
 * date and the other as the string it actually receives, and both are right.
 */
export const dateString: WireRule = {
  id: 'date-string',
  describe: 'a Date is serialised as a string',
  normalise: (view) => {
    const type = rename(view.type, 'Date', 'string');
    return changed(view.type, type) ? withRule({ ...view, type }, 'date-string') : view;
  },
};
