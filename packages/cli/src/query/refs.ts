import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { isResolved, resolveEntryRef } from '@flowatlas/mcp';
import { notFound } from '../exit.js';

/** How many near misses are worth printing when nothing matched. */
const NEAREST = 5;

const listed = (nodes: readonly GraphNode[]): string[] => nodes.map((node) => `  ${node.id}`);

/**
 * Progressively vaguer versions of what was typed.
 *
 * `POST /order/123` matches nothing whole, so the method is dropped and then
 * everything after the first segment, which is usually where the typo was.
 */
const looser = (text: string): string[] => {
  const attempts = [text];
  const path = /^[A-Za-z]+\s+(\/.*)$/.exec(text)?.[1];
  if (path !== undefined) attempts.push(path);
  const first = (path ?? text).replace(/^\//, '').split('/')[0];
  if (first !== undefined && first !== '' && !attempts.includes(first)) attempts.push(first);
  return attempts;
};

const nearest = (db: GraphDb, text: string, types: readonly string[]): string[] => {
  for (const attempt of looser(text)) {
    const found = db.search(attempt, { types, limit: NEAREST });
    if (found.length > 0) return ['did you mean:', ...listed(found)];
  }
  return [];
};

/** `event:order.created`, `cron:nightly`: a kind, then the key it is registered under. */
const KIND_REF = /^(event|cron|rpc):(.+)$/;

/**
 * Entries named by their kind and key rather than by a path.
 *
 * A channel handler and a scheduled job have no route to be named by, so this
 * is how they are asked for. It parses a reference and nothing else: what
 * happens after an entry is found is the same whatever kind it is (I8).
 */
const byKindRef = (db: GraphDb, ref: string): GraphNode[] => {
  const match = KIND_REF.exec(ref.trim());
  if (match === null) return [];
  const kind = match[1] as string;
  const key = (match[2] as string).trim();
  return db
    .nodesByType('entry', kind)
    .filter(
      (entry) =>
        String(entry.meta?.['pattern'] ?? entry.meta?.['key'] ?? '') === key ||
        entry.label === key ||
        entry.label === `${kind} ${key}`,
    );
};

/**
 * The entry someone means, or a stop listing the ones they might have meant.
 *
 * A route, a bot key, a channel name and a full id all arrive here and leave as
 * the same node, which is what lets one command answer for every kind of entry
 * point (I8). Two services serving the same route is never resolved by picking
 * one; `--service` is how the asker says which.
 */
export const resolveEntry = (db: GraphDb, ref: string, service?: string): GraphNode => {
  const found = resolveEntryRef(db, ref);
  if (isResolved(found)) return found.node;

  const matched = found.candidates.length > 0 ? found.candidates : byKindRef(db, ref);
  const candidates =
    service === undefined || matched.length < 2
      ? matched
      : matched.filter((node) => node.repo === service);
  if (candidates.length === 1) return candidates[0] as GraphNode;
  if (candidates.length > 1) {
    throw notFound(`${JSON.stringify(ref)} matches ${candidates.length} entries`, [
      ...listed(candidates),
      'narrow it with --service, or pass a full entry id',
    ]);
  }
  // `ui_action` as well as `entry`. A click in a template is a way in that
  // `flow` walks perfectly well, and it is the one kind with no name you could
  // say out loud — no route, no key, only an id ending in a line and a column.
  // Searching only `entry` meant the one reference nobody can guess was also
  // the one the tool refused to suggest.
  throw notFound(
    `no entry matches ${JSON.stringify(ref)}`,
    nearest(db, ref, ['entry', 'ui_action']),
  );
};

/**
 * The symbol someone means.
 *
 * A full id always wins. A bare `Class.method` is accepted only while it names
 * exactly one node, since answering for the wrong service's
 * `OrdersService.create` would be worse than asking which one was meant.
 */
export const resolveSymbol = (db: GraphDb, symbol: string, service?: string): GraphNode => {
  const trimmed = symbol.trim();
  const exact = db.node(trimmed);
  if (exact !== undefined) return exact;

  const pool = db
    .search(trimmed, { limit: 200 })
    .filter((node) => service === undefined || node.repo === service);
  // An exact label is what someone typing `Class.method` means; the wider
  // search is only there for when that finds nothing.
  const named = pool.filter((node) => node.label === trimmed);
  const matches = named.length > 0 ? named : pool;

  if (matches.length === 1) return matches[0] as GraphNode;
  if (matches.length > 1) {
    throw notFound(`${JSON.stringify(trimmed)} matches ${matches.length} symbols`, [
      ...listed(matches.slice(0, NEAREST)),
      'narrow it with --service, or pass a full node id',
    ]);
  }
  throw notFound(`no symbol matches ${JSON.stringify(trimmed)}`, nearest(db, trimmed, []));
};

/** `order.created` and `channel:order.created` name the same thing (I6). */
export const channelIdOf = (name: string): string => {
  const trimmed = name.trim();
  return trimmed.startsWith('channel:') ? trimmed : `channel:${trimmed}`;
};

export const resolveChannel = (db: GraphDb, name: string): GraphNode => {
  const id = channelIdOf(name);
  const node = db.node(id);
  if (node !== undefined) return node;
  throw notFound(`no channel named ${JSON.stringify(id)}`, nearest(db, name.trim(), ['channel']));
};
