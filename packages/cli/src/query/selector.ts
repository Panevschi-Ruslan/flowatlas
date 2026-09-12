import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { isResolved, resolveEntryRef } from '@flowatlas/mcp';

/**
 * What a selector turned out to mean.
 *
 * Three answers rather than two: one entry, several that all fit, or none with
 * the nearest misses. The third is what makes a typo recoverable without the
 * asker having to list the entries first.
 */
export type Selection =
  | { kind: 'one'; id: string; node: GraphNode }
  | { kind: 'several'; candidates: GraphNode[] }
  | { kind: 'none'; near: GraphNode[] };

const NEAR = 5;

/**
 * Works out which entry a selector names.
 *
 * The grammar is the server's: an id, `POST /orders` with a real order id in
 * the hole if that is how the asker thinks of it, `bot:order_confirm`, or a
 * label. Sharing it means the command line and an agent resolve a name the
 * same way, which they must, or a question answered in one place cannot be
 * repeated in the other.
 */
export const resolveSelector = (db: GraphDb, selector: string): Selection => {
  const ref = resolveEntryRef(db, selector);
  if (isResolved(ref)) return { kind: 'one', id: ref.id, node: ref.node };
  if (ref.candidates.length > 0) return { kind: 'several', candidates: ref.candidates };

  const needle = selector.trim().toLowerCase();
  const near = db
    .nodesByType('entry')
    .filter((entry) => {
      const key = `${entry.kind ?? ''} ${entry.label} ${entry.id}`.toLowerCase();
      return key.includes(needle);
    })
    .slice(0, NEAR);

  return { kind: 'none', near };
};

/** What went wrong, in the words the asker used. */
export const explainSelection = (selector: string, selection: Selection): string[] => {
  if (selection.kind === 'one') return [];
  if (selection.kind === 'several') {
    return [
      `${JSON.stringify(selector)} matches ${selection.candidates.length} entries:`,
      ...selection.candidates.map((node) => `  ${node.id}`),
    ];
  }
  return [
    `no entry matches ${JSON.stringify(selector)}`,
    ...(selection.near.length === 0
      ? []
      : ['Closest entries:', ...selection.near.map((node) => `  ${node.id}`)]),
  ];
};

/** What to do about it, which is a different sentence in each case. */
export const selectionHint = (selection: Selection): string => {
  if (selection.kind === 'one') return '';
  if (selection.kind === 'several') return 'Name one of them exactly; an entry id always resolves.';
  return selection.near.length === 0
    ? 'Run flowatlas dead --kind entries to see what the graph holds.'
    : 'Name one of these exactly, or run flowatlas dead --kind entries.';
};
