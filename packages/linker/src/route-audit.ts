import type { GraphEdge, GraphNode, Unresolved } from '@flowatlas/core';
import { cmp } from './order.js';

/** What decides that a route is meant to be open. */
export interface RouteAuditOptions {
  /** Decorators on a handler that say it is deliberately public. */
  publicDecorators: readonly string[];
  /** Routes that are public by decision, as `METHOD /path`; `*` matches the rest of a segment run. */
  publicRoutes: readonly string[];
  /** Guards that refuse nobody for who they are, by class name; not counted as gates. */
  nonGateWrappers?: readonly string[];
  /**
   * Decorators on a handler that switch a guard off for it — a flag the guard
   * reads through the reflector — and the guards each switches off, by class
   * name; an empty list switches off every guard.
   */
  skipGuardDecorators?: Readonly<Record<string, readonly string[]>>;
}

/** How far from a route its data access is looked for. */
const REACH = 8;

/** Wrapping that can refuse a request: a guard, or middleware that may be one. */
const GATES = new Set(['guard', 'middleware']);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A wrapper node's label names a class plainly, or with the arguments it was built with. */
const namedAs = (label: string, name: string): boolean => label === name || label.startsWith(`${name}(`);

const decoratorNames = (entry: GraphNode): string[] => {
  const decorators = entry.meta?.['decorators'];
  return Array.isArray(decorators)
    ? decorators
        .map((decorator) => (typeof decorator === 'object' && decorator !== null ? (decorator as { name?: unknown }).name : decorator))
        .filter((name): name is string => typeof name === 'string')
    : [];
};

/** `GET /api/*` against `GET /api/health`; `*` stands for any number of segments. */
const matchesRoute = (pattern: string, method: string, path: string): boolean => {
  const [wantedMethod, ...rest] = pattern.trim().split(/\s+/);
  const wantedPath = rest.join(' ');
  if (wantedMethod === undefined || wantedPath === '') return false;
  if (wantedMethod !== '*' && wantedMethod.toUpperCase() !== method.toUpperCase()) return false;
  const expression = new RegExp(
    `^${wantedPath.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
  );
  return expression.test(path);
};

/**
 * Two questions about the routes of a joined graph that no single file answers.
 *
 * A route with nothing in front of it that can refuse a request, and that
 * reaches stored data, is either public by decision or a hole; the graph cannot
 * tell which, so it lists the route and names the data, and a decorator or a
 * configured pattern says which ones were decided. A route a worker answers
 * before the application ever sees it has two handlers and two sets of checks,
 * and the application's handler, with whatever guards it declares, never runs.
 */
export const auditRoutes = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: Iterable<GraphEdge>,
  options: RouteAuditOptions,
): Unresolved[] => {
  const out = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge]);
    else list.push(edge);
  }
  const from = (id: string, type: GraphEdge['type']): GraphEdge[] =>
    (out.get(id) ?? []).filter((edge) => edge.type === type);

  /** The first stored data a route reaches, by the shortest walk. */
  const dataReached = (entryId: string): GraphNode | undefined => {
    const seen = new Set<string>([entryId]);
    let frontier = [entryId];
    for (let depth = 0; depth < REACH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const query = from(id, 'queries')[0];
        if (query !== undefined) return nodes.get(query.to);
        for (const edge of [...from(id, 'handles'), ...from(id, 'calls')]) {
          if (seen.has(edge.to)) continue;
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
      frontier = next.sort(cmp);
    }
    return undefined;
  };

  const rows: Unresolved[] = [];
  const entries = [...nodes.values()]
    .filter((node) => node.type === 'entry' && node.kind === 'http')
    .sort((a, b) => cmp(a.id, b.id));

  for (const entry of entries) {
    const method = text(entry.meta?.['method']);
    const path = text(entry.meta?.['path']);
    const wrapping = from(entry.id, 'guarded_by');
    const decorators = decoratorNames(entry);
    const skips = options.skipGuardDecorators ?? {};
    const skipping = decorators.filter((name) => Object.hasOwn(skips, name));
    /** The decorator on this handler that switches a guard off, if one does. */
    const skippedBy = (label: string): string | undefined =>
      skipping.find((name) => {
        const guards = skips[name] ?? [];
        return guards.length === 0 || guards.some((guard) => namedAs(label, guard));
      });
    const skipped: string[] = [];
    const gates = wrapping.filter((edge) => {
      const layer = text(edge.meta?.['layer']);
      if (!GATES.has(layer)) return false;
      const label = nodes.get(edge.to)?.label ?? '';
      if ((options.nonGateWrappers ?? []).some((name) => namedAs(label, name))) return false;
      const by = layer === 'guard' ? skippedBy(label) : undefined;
      if (by !== undefined) {
        skipped.push(`${label} (skipped by @${by})`);
        return false;
      }
      return true;
    });
    const middleware = Array.isArray(entry.meta?.['middleware']) ? (entry.meta['middleware'] as unknown[]) : [];

    // ---- a worker route in front of an application route -------------------
    const handlers = from(entry.id, 'handles');
    const controller = text(entry.meta?.['controller']);
    const application = handlers.filter(
      (edge) => controller !== '' && nodes.get(edge.to)?.label.startsWith(`${controller}.`) === true,
    );
    const worker = handlers.filter((edge) => !application.includes(edge));
    if (application.length > 0 && worker.length > 0 && entry.meta?.['registration'] !== undefined) {
      const names = (list: readonly GraphEdge[]): string =>
        list.map((edge) => nodes.get(edge.to)?.label ?? edge.to).join(', ');
      const guards = gates.map((edge) => nodes.get(edge.to)?.label ?? edge.to).sort(cmp);
      const [first] = worker;
      rows.push({
        service: entry.repo,
        file: first?.file ?? entry.file ?? '',
        line: first?.line ?? entry.line ?? 0,
        reason: 'route-shadowed',
        message:
          `${method} ${path} is answered by ${names(worker)} before ${names(application)} is reached; ` +
          `the application route's guards (${guards.length === 0 ? 'none' : guards.join(', ')}) never run, ` +
          `and the worker route has ${middleware.length === 0 ? 'no middleware' : `middleware ${middleware.map(String).join(', ')}`}.`,
        hint: 'Remove one of the two, or make the worker route apply the same checks the application route declares.',
        // Named as a route rather than by node id: this is a finding about the
        // route, not a place the map could not read, so a walk through the
        // route must not count it as something unresolved on its path.
        symbol: `${method} ${path}`,
      });
    }

    // ---- a route nothing guards that reaches stored data --------------------
    if (gates.length > 0 || middleware.length > 0) continue;
    if (decorators.some((name) => options.publicDecorators.includes(name))) continue;
    if (options.publicRoutes.some((pattern) => matchesRoute(pattern, method, path))) continue;
    const data = dataReached(entry.id);
    if (data === undefined) continue;
    // A route a worker declares may be covered by middleware the worker installs
    // for a whole prefix (`app.use('/api/*', auth)`), which is not read yet. It
    // is listed, but as something to look at rather than a finding.
    const byWorker = entry.meta?.['registration'] !== undefined && controller === '';
    rows.push({
      service: entry.repo,
      file: entry.file ?? '',
      line: entry.line ?? 0,
      reason: 'route-unguarded',
      ...(byWorker ? { level: 'info' as const } : {}),
      message: byWorker
        ? `${method} ${path} has no route middleware and reaches ${data.label}; middleware installed for a whole prefix is not read, so check it by hand.`
        : skipped.length > 0
          ? `${method} ${path} has no guard in front of it once ${skipped.sort(cmp).join(', ')}, and reaches ${data.label}.`
          : `${method} ${path} has no guard in front of it and reaches ${data.label}.`,
      hint: 'Add a guard, or mark it public: a decorator named under doctor.publicDecorators, or the route under doctor.publicRoutes.',
      symbol: `${method} ${path}`,
    });
  }
  return rows;
};

export { matchesRoute };
