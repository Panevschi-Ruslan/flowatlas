import { normalizePath, type GraphNode } from '@flowatlas/core';
import { answeringAt, isMatch, matchRoute, type GraphDb } from '@flowatlas/linker';
import { rankMatches } from './names.js';

/**
 * A name resolved to one node, or the nodes it could mean.
 *
 * `alsoAnswers` is set on a route said aloud that a less specific route
 * answers too (P94 D2): the most specific one is the answer, as the router
 * would have it, and the others are named so nothing is hidden.
 */
export type Resolved = { id: string; node: GraphNode; alsoAnswers?: string[] };
export type EntryRef = Resolved | { candidates: GraphNode[] };

export const isResolved = (ref: EntryRef): ref is Resolved => 'id' in ref;

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

/** A route registered for every verb answers this one too, as `matchRoute` reads it. */
const answersVerb = (entry: GraphNode, method: string): boolean => {
  const declared = String(entry.meta?.['method'] ?? '').toUpperCase();
  return declared === 'ALL' || declared === method;
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
    // how the person asking thinks of it and how the router resolves it. Where
    // two answer, the one that spells more of the address out wins, as it does
    // in the router and in the linker's own joins (P94): `/orders/latest` is
    // not `/orders/:param`. Two that spell it out alike stay candidates.
    const routes = entries.filter((entry) => entry.kind === 'http');
    const found = matchRoute(route.method, route.path, routes);
    if (isMatch(found)) {
      const also = routes
        .filter((entry) => entry.id !== found.entry.id && answersVerb(entry, route.method) && answeringAt(entry, route.path) !== undefined)
        .map((entry) => entry.id)
        .sort();
      return { id: found.entry.id, node: found.entry, ...(also.length === 0 ? {} : { alsoAnswers: also }) };
    }
    if (found.candidates.length > 0) {
      return { candidates: byId(found.candidates.map((id) => db.node(id)).filter((node) => node !== undefined)) };
    }
  }

  const key = asBotKey(trimmed);
  if (key !== undefined) {
    const matches = entries.filter(
      (entry) => String(entry.meta?.['key'] ?? entry.label) === key && entry.kind?.startsWith('bot_') === true,
    );
    if (matches.length === 1) return { id: matches[0]!.id, node: matches[0]! };
    if (matches.length > 1) return { candidates: byId(matches) };
  }

  // `invoke:library-dev-create-loan`: a function, by the name it is deployed
  // under, which is the key of its id.
  const invoked = /^invoke:(.+)$/.exec(trimmed)?.[1]?.trim();
  if (invoked !== undefined) {
    const matches = entries.filter((entry) => entry.kind === 'invoke' && String(entry.meta?.['key'] ?? '') === invoked);
    if (matches.length === 1) return { id: matches[0]!.id, node: matches[0]! };
    if (matches.length > 1) return { candidates: byId(matches) };
  }

  // Last resort: an entry whose label is exactly what was asked for.
  const named = entries.filter((entry) => entry.label === trimmed);
  if (named.length === 1) return { id: named[0]!.id, node: named[0]! };
  return { candidates: byId(named) };
};

/** How many near names a symbol that means more than one thing comes back with. */
const MAX_CANDIDATES = 8;

/**
 * Works out which node someone means, by any name a tool accepts (P94 D1).
 *
 * An id as it is; then an entry said aloud (`GET /orders/123`, `bot:x`,
 * `invoke:x`), exactly as {@link resolveEntryRef} reads it for `get_flow`;
 * then a fuzzy match that is the only best one. Anything else is the
 * candidates, never a guess, so a name that works in one tool works in all.
 */
export const resolveSymbol = (db: GraphDb, ref: string): EntryRef => {
  const trimmed = ref.trim();
  const exact = db.node(trimmed);
  if (exact !== undefined) return { id: exact.id, node: exact };

  const entry = resolveEntryRef(db, trimmed);
  if (isResolved(entry) || entry.candidates.length > 0) return entry;

  const ranked = rankMatches(db.search(trimmed, { limit: 200 }), trimmed);
  const best = ranked[0];
  if (best === undefined) return { candidates: [] };
  const tied = ranked.filter((match) => match.score === best.score);
  return tied.length === 1
    ? { id: best.node.id, node: best.node }
    : { candidates: tied.slice(0, MAX_CANDIDATES).map((match) => match.node) };
};
