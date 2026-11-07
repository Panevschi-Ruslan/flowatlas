import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { isResolved, resolveEntryRef, resolveSymbol as resolveSymbolRef } from '@flowatlas/mcp';
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

  const matched = found.candidates;
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
 * The symbol someone means, by the one resolution every tool uses (P94, P229).
 *
 * A full id always wins; then an entry said aloud, `POST /orders/123` as much
 * as `workflow:loan-approval`; then the only best near name. A bare
 * `Class.method` naming nodes in two services is never settled by picking
 * one, since answering for the wrong service's `OrdersService.create` would
 * be worse than asking which one was meant: `--service` says which.
 */
export const resolveSymbol = (db: GraphDb, symbol: string, service?: string): GraphNode => {
  const trimmed = symbol.trim();
  const found = resolveSymbolRef(db, trimmed, service);
  if (isResolved(found)) return found.node;
  if (found.candidates.length > 0) {
    throw notFound(`${JSON.stringify(trimmed)} matches ${found.candidates.length} symbols`, [
      ...listed(found.candidates.slice(0, NEAREST)),
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
