import {
  describedRequestsAt,
  precedenceOf,
  precedenceRows,
  type DescribedRequest,
  type HttpClientConfig,
  type Unresolved,
} from '@flowatlas/core';
import type { CallExpression } from 'ts-morph';

/**
 * Which described HTTP client a call is read as, if any (P121).
 *
 * The matching is the core's (`describedRequestsAt`), shared with both
 * browser readers; what is decided here is the server reader's side of it. A
 * call the reader's own clients already recognise - `fetch`, an installed
 * client - is read as that, and a pattern matching it too is shadowed. Of the
 * descriptions in configuration, one written by hand wins over a compiled
 * pattern, and two patterns on one call are ambiguous, so neither is read.
 */
export interface DescribedDecision {
  /** The described request to record, when one is read. */
  readonly request?: DescribedRequest;
  /** The rows the choice leaves at the call. */
  readonly rows: readonly Unresolved[];
}

export const describedRequestOf = (
  call: CallExpression,
  clients: readonly HttpClientConfig[],
  at: { readonly file: string; readonly line: number; readonly symbol: string },
  /** What else reads the call, by name, when the reader's own clients recognise it. */
  builtIn: string | undefined,
): DescribedDecision => {
  if (clients.length === 0) return { rows: [] };
  const matches = describedRequestsAt(call, clients);
  if (matches.length === 0) return { rows: [] };
  if (builtIn !== undefined) {
    // The tool's own reading wins over every description; a written one
    // under it says nothing, a pattern under it is shadowed.
    const shadowed = matches.flatMap((match) => (match.client.describedBy === undefined ? [] : [match.client.describedBy]));
    return { rows: precedenceRows({ chosen: [], shadowed: [...new Set(shadowed)], ambiguous: [] }, at, builtIn) };
  }
  const choice = precedenceOf(matches, (match) => match.client.describedBy);
  const rows = precedenceRows(choice, at, choice.chosen[0] === undefined ? undefined : 'a client described under adapters.http.clients');
  const request = choice.chosen[0];
  return request === undefined ? { rows } : { request, rows };
};
