import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { GraphEdge, GraphNode } from '@flowatlas/core';

/**
 * The names a prompt card can answer for (P386), written by `build` beside the
 * graph so the prompt hook can tell, from one flat file and without opening
 * the database, whether a prompt names anything the graph holds.
 *
 * Each name carries what it is, so the hook picks the tool that answers for
 * that kind of thing: a route its callers and ways in (`who_calls`), a method
 * handling one the ways in reaching it (`impact`), a method sending a request
 * to another repository where its requests land (`find_symbol`), any other
 * method its ways in when they cross a repository boundary (`impact`), a
 * channel or a message type its publishers and handlers (`who_emits`,
 * `who_consumes`), a deployed function its starters (`who_calls`).
 *
 * Imports nothing but types, so the hook's bundle stays a file read.
 */
export const CARD_NAMES_FILE = 'card-names.json';
export const CARD_NAMES_FORMAT_VERSION = 1;

export type CardKind = 'route' | 'handler' | 'client' | 'method' | 'function' | 'channel' | 'type';

export interface CardName {
  /**
   * What a prompt spells: a route's path with every parameter written
   * `:param`, `Class.method`, a plain function's name, a channel, a message
   * type's value, a deployed function's name.
   */
  text: string;
  kind: CardKind;
  /** The node the graph server's tools take. */
  id: string;
  /** The service the thing is declared in; null for a channel or a message type, which belong to none. */
  service: string | null;
  /** A route's verb. */
  verb?: string;
}

export interface CardIndex {
  cardNamesFormatVersion: number;
  /** When the graph the names are from was built, so a card says how old it is. */
  builtAt: string;
  /** Each service by name and by its repository's folder, either of which a prompt may say. */
  services: Array<{ name: string; folder: string }>;
  names: CardName[];
}

/**
 * A route's path as it is compared: every parameter, however a framework or a
 * client spells it (`:orderId`, `{orderId}`, `${orderId}`, `<orderId>`,
 * `[orderId]`, `[...slug]`), is `:param`; no query string, no trailing slash.
 */
export const routeKey = (path: string): string => {
  const bare = path.split(/[?#]/)[0] ?? path;
  const segments = bare
    .split('/')
    .map((segment) => (/^(?::.+|\{.*\}|\$\{.*\}|<.*>|\[.*\])$/.test(segment) ? ':param' : segment));
  const joined = segments.join('/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
};

/** `Class.method`: how a method is spelled in prose. */
export const MEMBER = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Which of two nodes spelled alike in one service a card is about: the one whose answer says the most. */
const RANK: Record<string, number> = { handler: 0, client: 1, method: 2, function: 3, consumer: 4 };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every name a prompt card can answer for, from the joined graph. */
export const cardNamesOf = (
  graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; builtAt?: string },
  services: Record<string, string>,
): CardIndex => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const into = new Map<string, GraphEdge[]>();
  const from = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    (into.get(edge.to) ?? into.set(edge.to, []).get(edge.to)!).push(edge);
    (from.get(edge.from) ?? from.set(edge.from, []).get(edge.from)!).push(edge);
  }
  const names: CardName[] = [];
  const handlers = new Set<string>();
  const clients = new Set<string>();

  for (const node of graph.nodes) {
    if (node.type === 'entry' && node.kind === 'http') {
      const path = typeof node.meta?.['path'] === 'string' ? (node.meta['path'] as string) : undefined;
      const verb = typeof node.meta?.['method'] === 'string' ? (node.meta['method'] as string).toUpperCase() : /^([A-Z]+)\s/.exec(node.label)?.[1];
      if (path !== undefined && path.startsWith('/')) {
        names.push({ text: routeKey(path), kind: 'route', id: node.id, service: node.repo ?? null, ...(verb === undefined ? {} : { verb }) });
      }
      for (const edge of from.get(node.id) ?? []) if (edge.type === 'handles') handlers.add(edge.to);
      // What sends a request to it from another repository: the method making the call, or the call's own node's caller.
      for (const edge of into.get(node.id) ?? []) {
        if (edge.type !== 'http_calls' && edge.type !== 'hits') continue;
        const call = byId.get(edge.from);
        if (call === undefined || call.repo === node.repo) continue;
        if (call.type === 'method' || call.type === 'function') clients.add(call.id);
        for (const back of into.get(call.id) ?? []) if (back.type === 'calls' && byId.get(back.from)?.repo === call.repo) clients.add(back.from);
      }
    } else if (node.type === 'entry' && node.kind === 'invoke') {
      const key = typeof node.meta?.['key'] === 'string' ? (node.meta['key'] as string) : undefined;
      if (key !== undefined) names.push({ text: key, kind: 'function', id: node.id, service: node.repo ?? null });
    } else if (node.type === 'channel') {
      if (node.kind === 'message_type') {
        const value = typeof node.meta?.['messageType'] === 'string' ? (node.meta['messageType'] as string) : node.label.split('#').at(-1);
        if (value !== undefined && value !== '') names.push({ text: value, kind: 'type', id: node.id, service: null });
      } else names.push({ text: node.label, kind: 'channel', id: node.id, service: null });
    }
  }

  // Code, by how it is spelled: one card per spelling and service, about the node whose answer says the most.
  const code = new Map<string, { node: GraphNode; rank: number; kind: CardKind }>();
  for (const node of graph.nodes) {
    if (node.type !== 'method' && node.type !== 'function' && node.type !== 'consumer') continue;
    if (!MEMBER.test(node.label) && !(node.type === 'function' && IDENTIFIER.test(node.label) && node.label.length >= 4)) continue;
    const kind: CardKind = handlers.has(node.id) ? 'handler' : clients.has(node.id) ? 'client' : 'method';
    const rank = RANK[kind === 'method' ? node.type : kind] ?? 9;
    const key = `${node.repo ?? ''}\u0000${node.label}`;
    const known = code.get(key);
    if (known === undefined || rank < known.rank || (rank === known.rank && node.id < known.node.id)) code.set(key, { node, rank, kind });
  }
  for (const { node, kind } of code.values()) names.push({ text: node.label, kind, id: node.id, service: node.repo ?? null });

  names.sort((a, b) => cmp(a.text, b.text) || cmp(a.id, b.id));
  return {
    cardNamesFormatVersion: CARD_NAMES_FORMAT_VERSION,
    builtAt: graph.builtAt ?? new Date(0).toISOString(),
    services: Object.entries(services)
      .map(([name, dir]) => ({ name, folder: basename(dir) }))
      .sort((a, b) => cmp(a.name, b.name)),
    names,
  };
};

/** The index at a path, or undefined when there is none, it cannot be read, or it is from another version. */
export const readCardNamesAt = (path: string): CardIndex | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CardIndex;
    return parsed.cardNamesFormatVersion === CARD_NAMES_FORMAT_VERSION && Array.isArray(parsed.names) && Array.isArray(parsed.services) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Writes the index beside the graph, unless it already says exactly this. */
export const writeCardNames = (outputDir: string, index: CardIndex): void => {
  const path = join(outputDir, CARD_NAMES_FILE);
  const text = `${JSON.stringify(index)}\n`;
  try {
    if (readFileSync(path, 'utf8') === text) return;
  } catch {
    // Not there yet.
  }
  writeFileSync(path, text, 'utf8');
};
