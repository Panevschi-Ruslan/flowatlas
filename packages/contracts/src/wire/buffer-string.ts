import { changed, rename, withRule, type WireRule } from './rule.js';

/**
 * Binary arrives as text.
 *
 * Whether it is base64 or hex is the two services' business; that it is not the
 * declared binary type on the far side is this rule's.
 */
export const bufferString: WireRule = {
  id: 'buffer-string',
  describe: 'a Buffer is serialised as a string',
  normalise: (view) => {
    const type = rename(view.type, 'Buffer', 'string');
    return changed(view.type, type) ? withRule({ ...view, type }, 'buffer-string') : view;
  },
};
