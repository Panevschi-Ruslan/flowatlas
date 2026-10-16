import type { DiffReport } from '@flowatlas/linker';

/**
 * What a branch did, for the Changes tab (P73), read from `flowatlas diff`'s
 * own report rather than worked out again.
 *
 * A route is a way in reached over HTTP. One that is gone and still has a
 * caller on the head side - an edge into it removed while the node it came
 * from is still there - is the break a reviewer most needs to see, so it is a
 * list of its own. Nodes are named by id and label: a removed one is not in
 * the head graph the page holds, so a position could not name it.
 */
export interface ChangeRoute {
  id: string;
  service: string;
  label: string;
}

export interface PackedChanges {
  base: string | null;
  head: string | null;
  routes: { added: ChangeRoute[]; removed: ChangeRoute[] };
  /** Removed routes something on the head side still calls, with what calls them. */
  stillCalled: Array<ChangeRoute & { callers: string[] }>;
  /** Declarations that changed shape, with one line per field that moved. */
  shapes: Array<{ id: string; name: string; fields: string[] }>;
  /** Contract findings this branch introduced. */
  gaps: Array<{ severity: string; kind: string; message: string }>;
  /** Unresolved rows on each side, so a rise in what did not join is visible. */
  unresolved: { base: number; head: number };
  counts: { nodesAdded: number; nodesRemoved: number; nodesChanged: number; edgesAdded: number; edgesRemoved: number };
}

/** `entry:<service>:http:<METHOD>:<path>`, the id every HTTP way in carries. */
const ROUTE_ID = /^entry:([^:]+):http:([^:]+):(.*)$/;

const routeOf = (id: string): ChangeRoute | null => {
  const found = ROUTE_ID.exec(id);
  return found === null ? null : { id, service: found[1] as string, label: `${found[2]} ${found[3]}` };
};

/**
 * A node id as a person reads it: `gateway: src/clients/orders.client.ts:33`
 * for `http_out:gateway#src/clients/orders.client.ts:33:12`, the id itself
 * for anything not shaped that way.
 */
export const placeOfId = (id: string): string => {
  const found = /^[a-z_]+:([^#]+)#(.+?)(?::(\d+))?(?::\d+)?$/.exec(id);
  if (found === null) return id;
  return `${found[1]}: ${found[2]}${found[3] === undefined ? '' : `:${found[3]}`}`;
};

const routes = (ids: readonly string[]): ChangeRoute[] =>
  ids.flatMap((id) => {
    const route = routeOf(id);
    return route === null ? [] : [route];
  });

export const packChanges = (report: DiffReport): PackedChanges => {
  const removedNodes = new Set(report.nodes.removed);
  const removed = routes(report.nodes.removed);
  const stillCalled = removed.flatMap((route) => {
    const callers = report.edges.removed
      .filter((edge) => edge.to === route.id && !removedNodes.has(edge.from))
      .map((edge) => placeOfId(edge.from));
    return callers.length === 0 ? [] : [{ ...route, callers: [...new Set(callers)].sort() }];
  });
  return {
    base: report.base.ref,
    head: report.head.ref,
    routes: { added: routes(report.nodes.added), removed },
    stillCalled,
    shapes: report.types.changed.map((change) => ({
      id: change.id,
      name: change.name,
      fields: change.fieldDiff.map((field) => field.message),
    })),
    gaps: report.contracts.new.map((finding) => ({
      severity: finding.severity,
      kind: finding.kind,
      message: finding.message,
    })),
    unresolved: { base: report.counts.base.unresolved.rows, head: report.counts.head.unresolved.rows },
    counts: {
      nodesAdded: report.nodes.added.length,
      nodesRemoved: report.nodes.removed.length,
      nodesChanged: report.nodes.changed.length,
      edgesAdded: report.edges.added.length,
      edgesRemoved: report.edges.removed.length,
    },
  };
};
