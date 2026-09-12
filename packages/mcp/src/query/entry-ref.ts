import { normalizePath, type GraphNode } from '@flowatlas/core';
import { pathAnswers, type GraphDb } from '@flowatlas/linker';

export type EntryRef = { id: string; node: GraphNode } | { candidates: GraphNode[] };

export const isResolved = (ref: EntryRef): ref is { id: string; node: GraphNode } => 'id' in ref;

/** `POST /orders/123` → the verb and the path a route would be registered under. */
const asRoute = (text: string): { method: string; path: string } | undefined => {
  const match = /^([A-Za-z]+)\s+(\/.*)$/.exec(text.trim());
  if (match === null) return undefined;
  return { method: (match[1] ?? '').toUpperCase(), path: normalizePath(match[2] ?? '/') };
};

/** `bot:order_confirm` → the key a bot entry is registered under. */
const asBotKey = (text: string): string | undefined => {
  const match = /^bot:(.+)$/.exec(text.trim());
  return match === null ? undefined : (match[1] ?? '').trim();
};

const byId = (nodes: readonly GraphNode[]): GraphNode[] =>
  [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Works out which entry someone means.
 *
 * A person says "POST /orders"; the graph calls it
 * `entry:orders:http:POST:/orders`. Both are accepted, and so is a bot key,
 * because the whole point is that the asker should not have to know the id
 * grammar. Two services serving the same route is not resolved by picking one:
 * the candidates come back and the asker says which.
 */
export const resolveEntryRef = (db: GraphDb, ref: string): EntryRef => {
  const trimmed = ref.trim();

  const exact = db.node(trimmed);
  if (exact !== undefined) return { id: exact.id, node: exact };

  const entries = db.nodesByType('entry');

  const route = asRoute(trimmed);
  if (route !== undefined) {
    // `/orders/12345` names the route registered as `/orders/:param`, which is
    // how the person asking thinks of it and how the router resolves it.
    const matches = entries.filter(
      (entry) =>
        entry.kind === 'http' &&
        String(entry.meta?.['method'] ?? '') === route.method &&
        pathAnswers(String(entry.meta?.['path'] ?? ''), route.path),
    );
    if (matches.length === 1) return { id: matches[0]!.id, node: matches[0]! };
    if (matches.length > 1) return { candidates: byId(matches) };
  }

  const key = asBotKey(trimmed);
  if (key !== undefined) {
    const matches = entries.filter(
      (entry) => String(entry.meta?.['key'] ?? entry.label) === key && entry.kind?.startsWith('bot_') === true,
    );
    if (matches.length === 1) return { id: matches[0]!.id, node: matches[0]! };
    if (matches.length > 1) return { candidates: byId(matches) };
  }

  // Last resort: an entry whose label is exactly what was asked for.
  const named = entries.filter((entry) => entry.label === trimmed);
  if (named.length === 1) return { id: named[0]!.id, node: named[0]! };
  return { candidates: byId(named) };
};
