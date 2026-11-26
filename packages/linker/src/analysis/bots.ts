import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '../db/reader.js';

/**
 * Where a bot's code is (P396), asked the same way by `impact` (a route whose
 * chain to the changed code runs through a bot's code is the bot's webhook)
 * and by `dead` (a route nothing in the project calls that hands its request
 * to a bot's code is the bot's way in, reached from outside, P400).
 */

/** A bot's way in: a command, a callback, an update, a step of a scene. */
export const isBotKind = (kind: string | undefined): boolean => kind !== undefined && (kind.startsWith('bot_') || kind === 'scene_step');

/**
 * The gaps that leave a bot's way in unnamed (P396): a trigger written as a
 * value, handlers registered where the reading could not find them. A file
 * holding one is a bot's, though no way in of it is drawn.
 */
const BOT_GAP_REASONS: ReadonlySet<string> = new Set(['dynamic-bot-trigger', 'bot-handlers-not-found']);

/** The key a file is held by in `botFilesOf`. */
export const botFileKey = (node: Pick<GraphNode, 'repo' | 'file'> | undefined): string | undefined =>
  node?.file === undefined ? undefined : `${node.repo}\u0000${node.file}`;

/**
 * The files of a bot's code, by `service\0file` (P396): where a bot's way in
 * is registered, where the code handling one is written, and where a bot's
 * trigger was left unread. A route handled in one of them is the bot's
 * webhook, how its updates arrive, and code in one of them behind an unread
 * call is the bot's: either breaks a bot, not an API.
 */
export const botFilesOf = (db: GraphDb): ReadonlySet<string> => {
  const files = new Set<string>();
  const add = (node: Pick<GraphNode, 'repo' | 'file'> | undefined): void => {
    const key = botFileKey(node);
    if (key !== undefined) files.add(key);
  };
  for (const entry of db.nodesByType('entry')) {
    if (!isBotKind(entry.kind)) continue;
    add(entry);
    for (const edge of db.edgesFrom(entry.id, ['handles'])) add(db.node(edge.to));
  }
  for (const row of db.allUnresolved()) if (row.service !== null && row.file !== null && BOT_GAP_REASONS.has(row.reason)) files.add(`${row.service}\u0000${row.file}`);
  return files;
};

/** How many calls deep a route's handler is followed to the bot's code it hands its request to. */
const MOST_HOPS = 3;

/** How many nodes that walk visits at most. */
const MOST_VISITED = 64;

/**
 * The bot's code a route hands its request to (P400): the first node, in a
 * bot's file, that the route's handler reaches within a few calls, the
 * handler itself where it is written in one. Undefined where none is: a
 * route of a service with no bot, or one whose handler reaches no bot's code
 * that near. A route read is never a bot's own way in, which the bot's
 * readers draw apart.
 */
export const botCodeBehind = (db: GraphDb, route: GraphNode, bots: ReadonlySet<string>): GraphNode | undefined => {
  if (bots.size === 0) return undefined;
  const isBot = (node: GraphNode | undefined): boolean => {
    const key = botFileKey(node);
    return key !== undefined && bots.has(key);
  };
  let frontier = db.edgesFrom(route.id, ['handles']).flatMap((edge) => db.node(edge.to) ?? []);
  const seen = new Set<string>(frontier.map((node) => node.id));
  for (let hop = 0; hop <= MOST_HOPS && frontier.length > 0; hop += 1) {
    const found = frontier.find(isBot);
    if (found !== undefined) return found;
    const next: GraphNode[] = [];
    for (const node of frontier) {
      for (const edge of db.edgesFrom(node.id, ['calls'])) {
        if (seen.has(edge.to) || seen.size >= MOST_VISITED) continue;
        seen.add(edge.to);
        const callee = db.node(edge.to);
        if (callee !== undefined) next.push(callee);
      }
    }
    frontier = next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return undefined;
};
