import {
  accessOf,
  DATA_REACH,
  failsWithAny,
  failuresOf,
  matchesRoutePattern,
  type Failure,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp } from './order.js';

/** What decides that a route is meant to be open. */
export interface RouteAuditOptions {
  /** Decorators on a handler that say it is deliberately public. */
  publicDecorators: readonly string[];
  /** Routes that are public by decision, as `METHOD /path`; `*` matches any run of characters. */
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
/** The statuses that refuse a request for who is asking. */
const REFUSING: ReadonlySet<number> = new Set([401, 403]);

/** `401, 403 or 423`. */
const statusList = (statuses: readonly number[]): string =>
  statuses.length <= 1 ? statuses.join('') : `${statuses.slice(0, -1).join(', ')} or ${statuses[statuses.length - 1]}`;

/**
 * What a throw that refuses a request is, in words: the class and its status,
 * or the helper that chooses it and what it can give (P90).
 */
const refusalSaid = (item: Failure): string => {
  if (item.via !== 'helper') return `${item.exception} (${item.status ?? '?'})`;
  const statuses = [...new Set((item.chosenFrom ?? []).flatMap((choice) => (choice.status === undefined ? [] : [choice.status])))].sort(
    (a, b) => a - b,
  );
  if (statuses.length === 0) return `through ${item.exception}(…) after a check of who is asking (the status it gives was not read)`;
  if (item.status !== undefined) return `through ${item.exception}(…) (${item.status})`;
  return `through ${item.exception}(…) (${statusList(statuses)}, chosen at run time)`;
};

/** Wrapping that can refuse a request: a guard, or middleware that may be one. */
const GATES = new Set(['guard', 'middleware']);

/** Where in the chain an edge sits, for a message that reads it back in order. */
const orderOf = (edge: GraphEdge): number => {
  const order = edge.meta?.['order'];
  return typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER;
};

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

/**
 * Whether `METHOD /path` with `*` for any run of characters covers this route.
 *
 * Kept in the core since P76, because an accepted rule asks the same question
 * of a route pattern; exported from here still for the readers that import it.
 */
export { matchesRoutePattern };

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

  /**
   * The first stored data a route reaches, by the shortest walk.
   *
   * The table where there is one, and the query itself where there is not. A
   * query whose table could not be read is still a route reaching stored data,
   * and asking only for the `queries` edge meant a library nobody has written a
   * descriptor for hid every unguarded route behind it. That is precisely
   * backwards: the less of a data layer this can read, the more a reader needs
   * to be told which routes reach it (R83).
   */
  const dataReached = (entryId: string): GraphNode | undefined => {
    const seen = new Set<string>([entryId]);
    let frontier = [entryId];
    for (let depth = 0; depth < DATA_REACH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const query = from(id, 'queries')[0];
        if (query !== undefined) return nodes.get(query.to);
        for (const edge of [...from(id, 'handles'), ...from(id, 'calls')]) {
          if (seen.has(edge.to)) continue;
          const reached = nodes.get(edge.to);
          // Only where the table is missing: a query that names one answers with
          // the table on the next step round, which is the better name for it
          // and the one every message here already carries.
          if (reached?.type === 'db_query' && from(edge.to, 'queries').length === 0) return reached;
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
    // What the reader of the framework read off the source (P76): which check
    // a decorator on this handler or its class switches off, because the check
    // reads the flag the decorator sets, and which decorators say the route is
    // open on purpose. Configuration says the same for a project whose
    // decorators this cannot follow; either is enough.
    const access = accessOf(entry);
    const readSkip = new Map((access?.guards ?? []).flatMap((guard) => (guard.skippedBy === undefined ? [] : [[guard.id, guard.skippedBy] as const])));
    const skipped: string[] = [];
    const gates = wrapping.filter((edge) => {
      const layer = text(edge.meta?.['layer']);
      if (!GATES.has(layer)) return false;
      const label = nodes.get(edge.to)?.label ?? '';
      if ((options.nonGateWrappers ?? []).some((name) => namedAs(label, name))) return false;
      const by = layer === 'guard' ? (readSkip.get(edge.to) ?? skippedBy(label)) : undefined;
      if (by !== undefined) {
        skipped.push(`${label} (skipped by @${by})`);
        return false;
      }
      return true;
    });
    /**
     * The middleware in front of this route, in the order it runs.
     *
     * Read off the edges, like everything else here. It used to be read off
     * `entry.meta.middleware`, and that is the whole of R109: the audit was the
     * only reader that knew middleware existed, because it was the only one
     * that had been told where to look, and every other consumer of the graph
     * saw a route with nothing in front of it. One question, asked once, of the
     * shape a guard has always had.
     */
    const middleware = wrapping
      .filter((edge) => text(edge.meta?.['layer']) === 'middleware')
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((edge) => nodes.get(edge.to)?.label ?? edge.to);

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
          `and the worker route has ${middleware.length === 0 ? 'no middleware' : `middleware ${middleware.join(', ')}`}.`,
        hint: 'Remove one of the two, or make the worker route apply the same checks the application route declares.',
        // Named as a route rather than by node id: this is a finding about the
        // route, not a place the map could not read, so a walk through the
        // route must not count it as something unresolved on its path.
        symbol: `${method} ${path}`,
      });
    }

    // ---- a route nothing guards that reaches stored data --------------------
    // Middleware is in `gates` already, because it is a `guarded_by` edge with
    // `layer: middleware` whoever read it, which is the point of R109.
    if (gates.length > 0) continue;
    // Said in so many words on the handler or its controller (P90): open on
    // purpose, and listed so the decision can be reviewed, since a marker that
    // silenced the audit would be a way to hide a hole. Nothing else is read as
    // public: not the verb, not the path, not any name.
    const publicNote = entry.meta?.['publicNote'];
    if (typeof publicNote === 'string') {
      const reached = dataReached(entry.id);
      const reaches = reached === undefined ? '' : ` and reaches ${reached.type === 'db_query' ? 'stored data' : reached.label}`;
      rows.push(
        publicNote === ''
          ? {
              service: entry.repo,
              file: entry.file ?? '',
              line: entry.line ?? 0,
              reason: 'marker-reason-missing',
              level: 'info' as const,
              message: `${method} ${path} has no guard in front of it${reaches}, and is marked @flowatlas-public with no reason given.`,
              hint: 'Taken as public. Write why after the marker, /** @flowatlas-public <why> */, so whoever reviews the route can check the decision still holds.',
              symbol: `${method} ${path}`,
            }
          : {
              service: entry.repo,
              file: entry.file ?? '',
              line: entry.line ?? 0,
              reason: 'route-public-declared',
              level: 'info' as const,
              message: `${method} ${path} has no guard in front of it${reaches}, and is declared public: ${publicNote}.`,
              hint: 'Decided on purpose, so nothing is missing. Check that the reason still holds.',
              symbol: `${method} ${path}`,
            },
      );
      continue;
    }
    if (decorators.some((name) => options.publicDecorators.includes(name))) continue;
    // Written on the handler or on its class, and read as open on purpose by
    // its name or the flag it sets: the same decision `publicDecorators` names,
    // without having to name it (P76).
    if ((access?.optOuts ?? []).some((item) => item.public || options.publicDecorators.includes(item.decorator))) continue;
    if (options.publicRoutes.some((pattern) => matchesRoutePattern(pattern, method, path))) continue;
    const found = dataReached(entry.id);
    if (found === undefined) continue;
    // What to call it. A table is named; a query whose table could not be read
    // has a label of its own — `access ?` — which reads as a typo in a sentence.
    // What the sentence has to say is that the route reaches the database at
    // all, and which table it reaches is the part nothing could establish (R83).
    const data = found.type === 'db_query' ? 'stored data' : found.label;

    // The handler says it refuses a request itself, which nothing here can see
    // and nothing here can check. Taken at its word — but listed, because
    // every other decision this audit takes on trust is listed, and a claim
    // nobody can see is the last one that should be invisible.
    const claimed = text(entry.meta?.['authNote']);
    if (claimed !== '') {
      rows.push({
        service: entry.repo,
        file: entry.file ?? '',
        line: entry.line ?? 0,
        reason: 'route-guard-skipped',
        level: 'info' as const,
        message: `${method} ${path} reaches ${data} with no guard in front of it, and says it checks the request itself: ${claimed}.`,
        hint: 'This cannot verify that. Check that the handler still does what its annotation says.',
        symbol: `${method} ${path}`,
      });
      continue;
    }
    // A route may be covered by middleware installed for a whole prefix
    // (`app.use('/api/*', auth)`) rather than named in its own declaration.
    // Some readers follow those installs through every mount and some cannot,
    // and only the reader knows which it was, so the reader says so and this
    // asks. Where it says it did not look, the route is listed as something to
    // check by hand rather than as a finding: a guard that may be there is not
    // a hole.
    //
    // Only an outright `false` counts. A reader that says nothing is not
    // admitting anything — the NestJS one, for instance, reads what is in front
    // of a route as edges rather than as metadata — and reading silence as
    // doubt would turn every finding this audit has into a caution.
    //
    // What was asked here before was the shape of the route: a registration
    // with no controller behind it. That was a fair proxy while the only reader
    // of that shape was one that did not read installs. It stopped being fair
    // the moment three more did, and a route with a real hole in front of it
    // was being reported as a caution about a limitation that had gone.
    /**
     * A route with nothing in front of it that refuses a request in its own code.
     *
     * A handler that reads a signed header and throws `UnauthorizedException`
     * when it does not verify is checking who is asking — in the body rather
     * than in a guard, but checking. The failures read off the way in (P68)
     * say so: a 401 or a 403 thrown on the route's own path. Not a hole, and
     * not proof either, since nothing here can tell whether the check comes
     * before the data is read; so it is listed, at `info`, with the throw it
     * rests on, and not as an unguarded route (P76).
     */
    // Thrown through a helper too (P90): `throw toHttpError(result)` refuses a
    // request when any exception the helper can choose is a 401 or a 403, or,
    // where its answer could not be read, when the test above the throw is of
    // what a check of who is asking answered.
    const refusals = failuresOf(entry).filter(
      (item) => item.source === 'throw' && (failsWithAny(item, REFUSING) || item.family === 'auth'),
    );
    const [refusal] = refusals;
    if (refusal !== undefined) {
      const where = nodes.get(refusal.at)?.label ?? refusal.at.split(/[#:]/).pop() ?? refusal.at;
      const place = refusal.file === undefined ? '' : `, ${refusal.file}${refusal.line === undefined ? '' : `:${refusal.line}`}`;
      const more = refusals.length > 1 ? ` and ${refusals.length - 1} more` : '';
      const helper = refusal.via === 'helper';
      rows.push({
        service: entry.repo,
        file: entry.file ?? '',
        line: entry.line ?? 0,
        reason: 'route-checked-in-body',
        level: 'info' as const,
        message:
          `${method} ${path} reaches ${data} with no guard in front of it, and refuses a request in its own code` +
          `${helper ? ' ' : ': '}${refusalSaid(refusal)} in ${where}${place}${more}.`,
        hint: helper
          ? 'The exception is chosen at run time by the helper; the statuses listed are what its table can give, and which one a request gets, or whether the check runs before the data is read, this cannot tell. A guard would make the check visible to every reader; /** @flowatlas-auth <how> */ on the handler says it in words.'
          : 'Nothing is missing if that check runs before the data is read, and this cannot tell the order. A guard would make the check visible to every reader; /** @flowatlas-auth <how> */ on the handler says it in words.',
        symbol: `${method} ${path}`,
      });
      continue;
    }

    const prefixUnread = entry.meta?.['middlewareRead'] === false;
    /**
     * A route nobody guarded and a route somebody unguarded are not one finding.
     *
     * Nothing in front of a route is somebody forgetting. A decorator the
     * project itself declared under `doctor.skipGuardDecorators`, written on
     * the handler, is somebody deciding — worth an audit, not worth the same
     * row, and above all not worth being told to write the same decision a
     * second time into `doctor.publicRoutes` (R33).
     */
    const decided = !prefixUnread && skipped.length > 0;
    rows.push({
      service: entry.repo,
      file: entry.file ?? '',
      line: entry.line ?? 0,
      reason: decided ? 'route-guard-skipped' : 'route-unguarded',
      ...(prefixUnread || decided ? { level: 'info' as const } : {}),
      message: prefixUnread
        ? `${method} ${path} has no route middleware and reaches ${data}; middleware installed for a whole prefix is not read, so check it by hand.`
        : decided
          ? `${method} ${path} reaches ${data} with no guard in front of it, because ${skipped.sort(cmp).join(', ')}.`
          : `${method} ${path} has no guard in front of it and reaches ${data}.`,
      hint: decided
        ? 'Decided on purpose, so nothing is missing. Check that the decision still holds; a handler that checks the request in its own body can say so with /** @flowatlas-auth <how> */.'
        : 'Add a guard, or mark it public: a decorator named under doctor.publicDecorators, or the route under doctor.publicRoutes. Routes public by decision can be accepted together: flowatlas accept route-unguarded --service <name> --path "<METHOD> /prefix/*" --note "<why>".',
      symbol: `${method} ${path}`,
    });
  }
  return rows;
};
