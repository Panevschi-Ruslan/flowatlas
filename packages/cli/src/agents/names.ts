import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphEdge, GraphNode } from '@flowatlas/core';

/**
 * The names a search hook can say something about (P227).
 *
 * Only names a search inside one repository cannot answer alone: a route,
 * channel or deployed function with something on the far side of a
 * repository boundary, and the handler method behind such a route. Each says
 * which services are on which side, so the hook can tell a search in one of
 * them what lies in the others (D4). Written by `build` beside the graph, a
 * flat file, so the hook reads it without opening the database (D6), and only
 * when it says something new, so a rebuild with nothing moved leaves it alone.
 */
export const NAMES_FILE = 'names.json';
export const NAMES_FORMAT_VERSION = 1;

export type NameKind = 'route' | 'channel' | 'function' | 'handler';

export interface IndexedName {
  /** What a search would spell: a path, a channel name, a deployed name, `Class.method`. */
  text: string;
  kind: NameKind;
  /** The node the graph server's tools take. */
  id: string;
  /** How a person says it, where that is not `text`: `GET /orders/:param` for a route. */
  label?: string;
  /** The service the thing is declared in, or null for a channel, which belongs to none. */
  service: string | null;
  /** How many nodes on the other side are in each service: callers, publishers, handlers. */
  across: Record<string, number>;
  /** What the far side is: who calls a route, who publishes and handles a channel. */
  role: 'callers' | 'publishers and handlers' | 'starters';
}

export interface NamesIndex {
  namesFormatVersion: number;
  /** Each service's repository directory, so a search's working directory says which service it is in. */
  services: Record<string, string>;
  names: IndexedName[];
}

const count = (into: Record<string, number>, service: string | undefined): void => {
  if (service === undefined) return;
  into[service] = (into[service] ?? 0) + 1;
};

/** Every name worth a hook's word, from the joined graph. */
export const namesOf = (graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }, services: Record<string, string>): NamesIndex => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const into = new Map<string, GraphEdge[]>();
  const from = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    (into.get(edge.to) ?? into.set(edge.to, []).get(edge.to)!).push(edge);
    (from.get(edge.from) ?? from.set(edge.from, []).get(edge.from)!).push(edge);
  }
  const names: IndexedName[] = [];
  const add = (name: IndexedName): void => {
    if (Object.keys(name.across).length > 0 && name.text.length >= 4) names.push(name);
  };

  for (const node of graph.nodes) {
    if (node.type === 'entry' && node.kind === 'http') {
      // Callers in another service: a request (`http_calls`) or a browser call (`hits`).
      const across: Record<string, number> = {};
      for (const edge of into.get(node.id) ?? []) {
        if (edge.type !== 'http_calls' && edge.type !== 'hits') continue;
        const caller = byId.get(edge.from);
        if (caller?.repo !== undefined && caller.repo !== node.repo) count(across, caller.repo);
      }
      const path = typeof node.meta?.['path'] === 'string' ? (node.meta['path'] as string) : undefined;
      if (path !== undefined) add({ text: path, kind: 'route', id: node.id, label: node.label, service: node.repo ?? null, across, role: 'callers' });
      // The method behind it, which is what a search for the handler finds.
      for (const edge of from.get(node.id) ?? []) {
        if (edge.type !== 'handles') continue;
        const handler = byId.get(edge.to);
        if (handler !== undefined && /\w\.\w/.test(handler.label)) {
          add({ text: handler.label, kind: 'handler', id: handler.id, service: handler.repo ?? null, across, role: 'callers' });
        }
      }
    } else if (node.type === 'entry' && node.kind === 'invoke') {
      const across: Record<string, number> = {};
      for (const edge of into.get(node.id) ?? []) {
        const starter = byId.get(edge.from);
        if (starter?.repo !== undefined && starter.repo !== node.repo) count(across, starter.repo);
      }
      const key = typeof node.meta?.['key'] === 'string' ? (node.meta['key'] as string) : undefined;
      if (key !== undefined) add({ text: key, kind: 'function', id: node.id, service: node.repo ?? null, across, role: 'starters' });
    } else if (node.type === 'channel') {
      // Both ends: what publishes onto it and what takes it off, by service.
      const across: Record<string, number> = {};
      for (const edge of into.get(node.id) ?? []) if (edge.type === 'emits') count(across, byId.get(edge.from)?.repo);
      for (const edge of from.get(node.id) ?? []) if (edge.type === 'consumes') count(across, byId.get(edge.to)?.repo);
      // A channel only one service touches is a search's to answer.
      if (Object.keys(across).length > 1) add({ text: node.label, kind: 'channel', id: node.id, service: null, across, role: 'publishers and handlers' });
    }
  }
  names.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : a.id < b.id ? -1 : 1));
  return { namesFormatVersion: NAMES_FORMAT_VERSION, services, names };
};

/** The index beside a database, or undefined when there is none or it is from another version. */
export const readNames = (outputDir: string): NamesIndex | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(join(outputDir, NAMES_FILE), 'utf8')) as NamesIndex;
    return parsed.namesFormatVersion === NAMES_FORMAT_VERSION && Array.isArray(parsed.names) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Writes the index beside the graph, unless it already says exactly this. */
export const writeNames = (outputDir: string, index: NamesIndex): void => {
  const path = join(outputDir, NAMES_FILE);
  const text = `${JSON.stringify(index)}\n`;
  try {
    if (readFileSync(path, 'utf8') === text) return;
  } catch {
    // Not there yet.
  }
  writeFileSync(path, text, 'utf8');
};
