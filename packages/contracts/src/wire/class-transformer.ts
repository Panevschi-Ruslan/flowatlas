import { metaFlag, metaString, withRule, type FieldView, type WireRule } from './rule.js';

/**
 * The serialisation annotations, which move a field's name, drop it, or make
 * its value the annotation's business rather than the type's.
 *
 * The extractor records the four of them without deciding what any of them
 * means for compatibility (P02 §15). Deciding is this rule's whole job:
 *
 * - excluded ⇒ the field is not on the wire at all, from either end. A sender
 *   that excludes it sends nothing; a receiver that excludes it reads nothing,
 *   so anything sent lands nowhere.
 * - renamed ⇒ the wire carries the new name, and the two ends match on that.
 * - transformed ⇒ a function decides the value, and no declaration says what it
 *   returns, so the shape is opaque rather than wrong.
 *
 * Exposing a field without renaming it changes no shape and is deliberately not
 * reported: it only matters when the serialiser is run in a strategy that hides
 * everything else, which is not something the graph can see.
 */
export const classTransformer: WireRule = {
  id: 'class-transformer',
  describe: 'serialisation annotations rename, drop, or take over a field',
  normalise: (view) => {
    let next: FieldView = view;
    if (metaFlag(view, 'exclude')) next = withRule({ ...next, dropped: true }, 'class-transformer');

    const renamed = metaString(view, 'exposeAs');
    if (renamed !== undefined && renamed !== view.name) {
      next = withRule({ ...next, name: renamed }, 'class-transformer');
    }

    if (metaFlag(view, 'transform')) {
      next = withRule({ ...next, opaque: true }, 'class-transformer:transform');
    }
    return next;
  },
};
