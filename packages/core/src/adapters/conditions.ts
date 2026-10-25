import { evaluateExpression } from '../static-value.js';
import { locatedExpressions, type LocatorContext, type LocatorSite, type NameLocator } from './locator.js';

/**
 * A value a call must write at a place for a description to apply (P121).
 *
 * The place is a locator, the same vocabulary every description says where a
 * name is written in, and the value is read the way a name is: a literal, a
 * constant, an enum member. Pattern files write these for the literals in a
 * pattern - `$API.call('POST', $URL)` applies only where the first argument
 * reads as `'POST'` - and a description written by hand may say the same.
 */
export interface DescriptionCondition {
  readonly at: NameLocator;
  readonly equals: string | number | boolean | null;
}

/**
 * Whether a call or a decorator writes every value its description requires.
 *
 * No conditions is yes. A condition whose place the call does not write, or
 * writes as something nothing can read, is no: the description is about calls
 * that say this, and a call that does not say it is some other call - not a
 * call of this kind whose name could not be read, which is a row.
 */
export const conditionsHold = (
  site: LocatorSite,
  where: readonly DescriptionCondition[] | undefined,
  context: LocatorContext = {},
): boolean =>
  (where ?? []).every((condition) => {
    const [written] = locatedExpressions(site, [condition.at], context);
    if (written === undefined) return false;
    const value = evaluateExpression(written);
    return value.resolved && value.value === condition.equals;
  });
