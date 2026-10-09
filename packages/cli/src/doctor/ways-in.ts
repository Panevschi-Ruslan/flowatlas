/**
 * Ways in found, against ways in whose body was read.
 *
 * One definition, because two commands say it: `build` prints the figure and
 * `doctor` decides on it. Two copies of "was this body read" would be two
 * answers the day one of them learns a third condition (R94).
 */
import { wayInBodyRead, type GraphNode } from '@flowatlas/core';

export interface WaysIn {
  found: number;
  /** Of those, the ones with a handler whose body was read. */
  read: number;
}

/** Whether the code behind one way in was read: the core's one definition. */
const bodyRead = wayInBodyRead;

/** Every service's ways in, found and read; a service with none is absent. */
export const waysInByService = (
  entries: readonly GraphNode[],
  handled: (id: string) => boolean,
): Map<string, WaysIn> => {
  const byService = new Map<string, WaysIn>();
  for (const entry of entries) {
    const ways = byService.get(entry.repo) ?? { found: 0, read: 0 };
    byService.set(entry.repo, {
      found: ways.found + 1,
      read: ways.read + (bodyRead(entry, handled) ? 1 : 0),
    });
  }
  return byService;
};

/** The same figure over the whole graph. */
export const waysInTotal = (byService: ReadonlyMap<string, WaysIn>): WaysIn =>
  [...byService.values()].reduce(
    (sum, ways) => ({ found: sum.found + ways.found, read: sum.read + ways.read }),
    { found: 0, read: 0 },
  );

/**
 * Whether a service's ways in are mostly ones nobody read past the address.
 *
 * "Most" is the line because it is the line at which the graph's answer about
 * this service's handlers is "not read" more often than it is anything else:
 * below it the graph describes the service with gaps it names, above it the
 * graph describes the service's file names. It is decided per service, so a
 * service read end to end cannot carry a hollow one past the check by
 * outnumbering it.
 */
export const mostlyUnread = (ways: WaysIn): boolean => ways.found - ways.read > ways.read;

/**
 * What is said of a service with no way in at all (R170): that, then what its
 * repository looks like, then what follows. One sentence for the verdict and
 * the head of the report, which say it in the same words.
 */
export const noWayInSentence = ({ service, looksLike }: { service: string; looksLike: string }): string =>
  `${service}: no way in was found — ${looksLike}. Its code was read and nothing in this graph` +
  ' reaches it, so no flow starts there';
