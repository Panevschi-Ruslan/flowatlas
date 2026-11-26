import { normalizePath, type GraphNode } from '@flowatlas/core';
import { answeringAt, isMatch, matchRoute, type GraphDb } from '@flowatlas/linker';
import { resolveChannelRef } from './channel-ref.js';
import { rankMatches } from './names.js';

/**
 * A name resolved to one node, or the nodes it could mean.
 *
 * `alsoAnswers` is set on a route said aloud that a less specific route
 * answers too (P94 D2): the most specific one is the answer, as the router
 * would have it, and the others are named so nothing is hidden.
 * `channelUsed` is set on a channel written another way than the graph
 * spells it (`tenant:<id>:events`, P360): the channel id answered for.
 */
export type Resolved = { id: string; node: GraphNode; alsoAnswers?: string[]; channelUsed?: string; fuzzy?: true };
/**
 * `fuzzy` (P381): no name holds what was asked; the nodes are only near it
 * (by initials, inside an id), so an answer about them is never the whole
 * answer to what was asked.
 */
export type EntryRef = Resolved | { candidates: GraphNode[]; fuzzy?: true };

/** The score from which a name match is near rather than holding the name asked (`rankMatches`: initials, then inside the id). */
const NEAR_SCORE = 3;

export const isResolved = (ref: EntryRef): ref is Resolved => 'id' in ref;

/** `POST /orders/123` → the verb and the path a route would be registered under. */
const asRoute = (text: string): { method: string; path: string } | undefined => {
  const match = /^([A-Za-z]+)\s+(\/.*)$/.exec(text.trim());
  if (match === null) return undefined;
  return { method: (match[1] ?? '').toUpperCase(), path: normalizePath(match[2] ?? '/') };
};

/** `event:order.created`, `cron:nightly`, `rpc:orders.list`, `workflow:loan-approval`. */
const KIND_REF = /^(event|cron|rpc|workflow):(.+)$/;

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
export const resolveEntryRef = (db: GraphDb, ref: string, service?: string): EntryRef => {
  const trimmed = ref.trim();

  const exact = db.node(trimmed);
  if (exact !== undefined) return { id: exact.id, node: exact };

  // With a service, a route said aloud is matched among that service's routes alone (P381): the router of the
  // service asked about decides, and a more specific route another service serves is not this one.
  const entries = db.nodesByType('entry').filter((entry) => service === undefined || entry.repo === service);

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

  // `event:order.created`, `cron:nightly`, `rpc:orders.list`,
  // `workflow:loan-approval`: a kind, then the key it is registered under. A
  // channel handler and a scheduled job have no route to be named by, so this
  // is how they are asked for. It was the command line's alone (P229), so
  // `flowatlas flow "workflow:x"` answered and `get_flow` with the same name
  // did not.
  const kinded = KIND_REF.exec(trimmed);
  if (kinded !== null) {
    const kind = kinded[1] as string;
    const key = (kinded[2] as string).trim();
    const matches = entries.filter(
      (entry) =>
        entry.kind === kind &&
        (String(entry.meta?.['pattern'] ?? entry.meta?.['key'] ?? '') === key || entry.label === key || entry.label === `${kind} ${key}`),
    );
    if (matches.length === 1) return { id: matches[0]!.id, node: matches[0]! };
    if (matches.length > 1) return { candidates: byId(matches) };
  }

  // A channel written with placeholders (`tenant:<id>:events`) or with its
  // prefix and a value it takes (`channel:tenant:42:events`), P360: the
  // channel it denotes, or the channels it fits. A plain word is not read as
  // one here: any tool's name is far more often a symbol's.
  const channel = resolveChannelRef(db, trimmed, { anyName: true });
  if (channel !== undefined) {
    if (!('candidates' in channel)) {
      return { id: channel.node.id, node: channel.node, ...(channel.channelUsed === undefined ? {} : { channelUsed: channel.channelUsed }) };
    }
    return { candidates: channel.candidates };
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
 *
 * `service` narrows a name to one service, as the command line's `--service`
 * does (P229): an entry said aloud or a near name found in another service is
 * looked for again inside this one. A full id is never narrowed: it already
 * says which node it means. A channel belongs to no service and is found
 * whatever the service.
 *
 * A match only near what was asked (initials, inside an id) says `fuzzy`
 * (P381), so no tool calls an answer about it complete.
 */
export const resolveSymbol = (db: GraphDb, ref: string, service?: string): EntryRef => {
  const trimmed = ref.trim();
  const exact = db.node(trimmed);
  if (exact !== undefined) return { id: exact.id, node: exact };

  const inService = (node: GraphNode): boolean => service === undefined || node.repo === service || node.repo === '';
  const entry = resolveEntryRef(db, trimmed, service);
  if (isResolved(entry)) {
    if (inService(entry.node)) return entry;
  } else if (entry.candidates.length > 0) {
    const kept = entry.candidates.filter(inService);
    if (kept.length === 1) return { id: kept[0]!.id, node: kept[0]! };
    if (kept.length > 1) return { candidates: kept };
  }

  const ranked = rankMatches(db.search(trimmed, { limit: 200 }).filter(inService), trimmed);
  const best = ranked[0];
  if (best === undefined) return { candidates: [] };
  const tied = ranked.filter((match) => match.score === best.score);
  const fuzzy = best.score >= NEAR_SCORE ? { fuzzy: true as const } : {};
  return tied.length === 1
    ? { id: best.node.id, node: best.node, ...fuzzy }
    : { candidates: tied.slice(0, MAX_CANDIDATES).map((match) => match.node), ...fuzzy };
};
