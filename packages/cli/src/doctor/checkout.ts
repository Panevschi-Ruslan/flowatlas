import { checkoutLine, type CheckoutMoved, type Unresolved } from '@flowatlas/core';

/**
 * The reason a row about a checkout that moved since the build carries (P230).
 *
 * Asked when `doctor` runs, like the age of a declared document (R78): the
 * commit a checkout is on moves whenever anybody switches branch, so the
 * build records the one it read and this is the only place the two are
 * compared. Info: it decides no exit code and moves no baseline, since a graph
 * one commit behind is often all anyone needs.
 */
export const CHECKOUT_REASON = 'checkout-moved';

/** One row per service whose checkout is not where the build found it. */
export const checkoutRows = (moved: readonly CheckoutMoved[]): Unresolved[] =>
  moved.map((item) => ({
    file: '.',
    line: 1,
    reason: CHECKOUT_REASON,
    level: 'info',
    service: item.service,
    symbol: item.service,
    message: `${checkoutLine(item)}: the graph describes the commit it was built on`,
    hint: 'Run flowatlas build; flowatlas hook install rebuilds in the background after every checkout and merge.',
  }));
