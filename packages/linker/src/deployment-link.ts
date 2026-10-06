import {
  makeEntryId,
  makeHttpEntryKey,
  normalizePath,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Two joins a deployment needs that no single repository can make (P21).
 *
 * **A route that hangs from another repository's API.** A shared REST API is
 * declared once, by whichever repository owns it, and other repositories hang
 * their resources from a point of it they look up: a parameter the owner wrote
 * the point's id into, or an output of the owner's state. Reading one repository
 * gives the part of the path it adds and the name of the point, never the path
 * of the point itself. The owner's repository says what that path is, on its own
 * repository node, and this is where the two meet - by name, the way a
 * publisher and a consumer meet on a channel. The route's id is rewritten to the
 * full path, so everything after the link (matching a client's request, `flow
 * 'POST /v1/loans'`) sees one route at one address.
 *
 * **A route answered by a function another repository deploys.** An
 * integration may name its function by the name it is deployed under rather
 * than by a reference, and the function is then an `invoke` entry in some other
 * service. The route takes that entry's handler, and the middleware in front of
 * it, as its own, which is what running the route does; where the function's
 * code was not read, it reaches the function's entry instead.
 *
 * Both are joins on a name somebody wrote on each side. A name that matches
 * nothing, or matches two different things, is a row and no edge.
 */

interface Published {
  readonly service: string;
  readonly path: string;
  readonly api?: string;
}

const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A root's key as a phrase. */
const describeRoot = (key: string): string => {
  if (key.startsWith('parameter:')) return `the parameter ${key.slice('parameter:'.length)}`;
  if (key.startsWith('state:')) {
    const [state, output] = key.slice('state:'.length).split('#');
    return `the output ${output ?? '?'} of the state ${state ?? '?'}`;
  }
  return key;
};

/** Points of an API each repository publishes, by key. */
const publishedRoots = (nodes: ReadonlyMap<string, GraphNode>): Map<string, Published[]> => {
  const out = new Map<string, Published[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'repo') continue;
    const roots = node.meta?.['apiRoots'];
    if (!Array.isArray(roots)) continue;
    for (const root of roots as Array<Record<string, unknown>>) {
      const key = stringOf(root['key']);
      const path = stringOf(root['path']);
      if (key === undefined || path === undefined) continue;
      const api = stringOf(root['api']);
      out.set(key, [...(out.get(key) ?? []), { service: node.repo, path, ...(api === undefined ? {} : { api }) }]);
    }
  }
  return out;
};

/** Moves a node to a new id, with every edge and row that names it. */
const renameNode = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  rows: Unresolved[],
  from: string,
  to: GraphNode,
): void => {
  nodes.delete(from);
  nodes.set(to.id, to);
  for (const [key, edge] of [...edges]) {
    if (edge.from !== from && edge.to !== from) continue;
    edges.delete(key);
    const moved = { ...edge, from: edge.from === from ? to.id : edge.from, to: edge.to === from ? to.id : edge.to };
    edges.set(edgeKey(moved), moved);
  }
  for (const row of rows) if (row.symbol === from) row.symbol = to.id;
};

const findingAt = (entry: GraphNode, row: Omit<Unresolved, 'file' | 'line' | 'service'>): Unresolved => ({
  service: entry.repo,
  file: entry.file ?? '',
  line: entry.line ?? 0,
  ...row,
  symbol: entry.id,
});

/** Routes rewritten to the full path of the point they hang from. */
const rootRoutes = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, rows: Unresolved[]): Unresolved[] => {
  const findings: Unresolved[] = [];
  const published = publishedRoots(nodes);
  const rooted = [...nodes.values()]
    .filter((node) => node.type === 'entry' && node.kind === 'http' && stringOf(node.meta?.['root']) !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  for (const entry of rooted) {
    const key = stringOf(entry.meta?.['root']) as string;
    const below = stringOf(entry.meta?.['below']) ?? '/';
    const method = stringOf(entry.meta?.['method']) ?? 'ALL';
    const owners = published.get(key) ?? [];
    const paths = [...new Set(owners.map((owner) => owner.path))];
    if (paths.length === 0) {
      findings.push(
        findingAt(entry, {
          reason: 'route-root-not-found',
          message: `${method} ${below} hangs from ${describeRoot(key)}, which no configured service publishes, so its full path is not known`,
          hint: 'Add the repository that declares that API, and writes that point of it, to the configuration. Until then nothing can call this route.',
        }),
      );
      continue;
    }
    if (paths.length > 1) {
      findings.push(
        findingAt(entry, {
          reason: 'route-root-ambiguous',
          message: `${method} ${below} hangs from ${describeRoot(key)}, which ${owners.map((owner) => `${owner.service} publishes as ${owner.path}`).join(' and ')}`,
          hint: 'Two services cannot both own one point of an API; one of the two declarations is stale or names the wrong point.',
        }),
      );
      continue;
    }
    const owner = owners[0] as Published;
    const full = normalizePath(`${owner.path}/${below}`);
    const id = makeEntryId(entry.repo, 'http', makeHttpEntryKey(method, full));
    if (nodes.has(id)) {
      findings.push(
        findingAt(entry, {
          reason: 'route-root-ambiguous',
          message: `${method} ${full} is declared twice in ${entry.repo}: once under its full path and once hanging from ${describeRoot(key)}`,
          hint: 'One of the two declarations is a copy of the other; remove one.',
        }),
      );
      continue;
    }
    renameNode(nodes, edges, rows, entry.id, {
      ...entry,
      id,
      label: `${method} ${full}`,
      meta: {
        ...entry.meta,
        path: full,
        rootedIn: owner.service,
        rootPath: owner.path,
        ...(entry.meta?.['api'] === undefined && owner.api !== undefined ? { api: owner.api } : {}),
      },
    });
  }
  return findings;
};

/** Routes that name their function by its deployed name, joined to the function. */
const joinInvocations = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const findings: Unresolved[] = [];
  const byName = new Map<string, GraphNode[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry' || node.kind !== 'invoke') continue;
    const name = stringOf(node.meta?.['name']);
    if (name === undefined) continue;
    byName.set(name, [...(byName.get(name) ?? []), node]);
  }
  const callers = [...nodes.values()]
    .filter((node) => node.type === 'entry' && stringOf(node.meta?.['invokes']) !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  for (const entry of callers) {
    const name = stringOf(entry.meta?.['invokes']) as string;
    const targets = byName.get(name) ?? [];
    if (targets.length !== 1) {
      findings.push(
        findingAt(entry, {
          reason: targets.length === 0 ? 'invoke-target-not-found' : 'invoke-target-ambiguous',
          message:
            targets.length === 0
              ? `${entry.label} is answered by the function ${name}, which no configured service deploys`
              : `${entry.label} is answered by the function ${name}, which ${targets.map((target) => target.repo).join(' and ')} both deploy`,
          hint:
            targets.length === 0
              ? 'Add the repository that deploys it to the configuration, so the route reaches its code.'
              : 'A deployed name belongs to one function; one of the two declarations is stale, or they are two environments that a variable file should tell apart.',
        }),
      );
      continue;
    }
    const target = targets[0] as GraphNode;
    let handled = false;
    for (const edge of [...edges.values()]) {
      if (edge.from !== target.id || (edge.type !== 'handles' && edge.type !== 'guarded_by')) continue;
      handled ||= edge.type === 'handles';
      const joined: GraphEdge = { ...edge, from: entry.id, meta: { ...edge.meta, via: 'function-name', function: target.id } };
      if (!edges.has(edgeKey(joined))) edges.set(edgeKey(joined), joined);
    }
    // A function whose code was not read is reached at its entry, where the
    // rows saying why sit, so a walk from the route passes them (R173).
    if (!handled) {
      const reached: GraphEdge = { from: entry.id, to: target.id, type: 'calls', confidence: 'static', meta: { via: 'function-name' } };
      if (entry.file !== undefined) reached.file = entry.file;
      if (entry.line !== undefined) reached.line = entry.line;
      if (!edges.has(edgeKey(reached))) edges.set(edgeKey(reached), reached);
    }
    entry.meta = { ...entry.meta, function: name, functionService: target.repo };
  }
  return findings;
};

/**
 * Makes both joins, in place, and returns the rows for what did not join.
 *
 * Routes are rooted first, so an integration joined afterwards is joined from
 * the id the route ends up with.
 */
export const joinDeployments = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  rows: Unresolved[],
): Unresolved[] => [...rootRoutes(nodes, edges, rows), ...joinInvocations(nodes, edges)];
