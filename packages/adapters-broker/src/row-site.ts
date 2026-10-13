import type { Unresolved } from '@flowatlas/core';

/**
 * Where a row about one call sits: the body a reader would annotate, as it is
 * named in the source, and the node drawn for the call, when one was.
 */
export interface RowSite {
  /** The body the call is written in, as a reader names it: `OrdersService.publish`, `handler`. */
  readonly named: string;
  /** The producer drawn for the call, which a walk through the body passes. */
  readonly node?: string;
}

/**
 * What a row about a call names, decided here for every reader of a publish or
 * a start.
 *
 * A row names the node a walk passes (R173). A publish or a start whose name
 * could not be read is still drawn, as a producer the body calls, so that is
 * the node, and `flow` through the body counts the row (R177); what could not
 * be read - the body, then the expression - is the message. A handler whose
 * channel could not be read is drawn on no channel and under no entry, so
 * nothing a walk passes is about it, and its row keeps naming the body as it is
 * written, which is what `doctor` puts an annotation's check on.
 */
export const rowAbout = (site: RowSite, text: string): Pick<Unresolved, 'symbol' | 'message'> => {
  const said = `${site.named} -> ${text.slice(0, 60)}`;
  return site.node === undefined ? { symbol: said } : { symbol: site.node, message: said };
};
