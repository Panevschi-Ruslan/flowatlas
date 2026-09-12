/**
 * Whether the annotations still say what the code says.
 *
 * An annotation exists for the places static reading is blind (I10), which
 * makes it the one claim in the graph nothing else checks. It is also the claim
 * most likely to go stale: the channel is renamed, the route moves, the publish
 * is deleted, and the annotation stays behind asserting a link that no longer
 * exists. Six months of that and the map is confidently wrong.
 *
 * Every rule here is asked of the graph and of nothing else. No source file is
 * opened: what the graph cannot see, the extractor has to record, and a second
 * reader of the source in this package would be a second opinion about what the
 * code says — which is exactly the disagreement this command exists to prevent.
 */
import { wasRead, type GraphNode, type Unresolved } from '@flowatlas/core';
import { isMatch, matchRoute, type GraphDb } from '@flowatlas/linker';

/**
 * What can be wrong with an annotation.
 *
 * Errors are claims the graph contradicts; warnings are annotations the graph
 * has made redundant, or that assert something about a symbol nothing else
 * agrees is that kind of symbol. Only the errors fail a build, because a
 * redundant annotation is untidy and a false one is a lie.
 */
export const MARKER_CODES = [
  'marker-emits-without-emit',
  'marker-emits-shadowed',
  'marker-consumes-without-consumer',
  'marker-consumes-shadowed',
  'marker-callsservice-unknown-service',
  'marker-callsservice-route-missing',
  'marker-callsservice-shadowed',
  'marker-flowentry-not-handler',
  'marker-contractignore-unused',
  'marker-unknown-arg',
] as const;

export type MarkerCode = (typeof MARKER_CODES)[number];

/** Which codes stop a build. */
const ERRORS: ReadonlySet<string> = new Set<MarkerCode>([
  'marker-emits-without-emit',
  'marker-consumes-without-consumer',
  'marker-callsservice-unknown-service',
  'marker-callsservice-route-missing',
  'marker-unknown-arg',
]);

export interface MarkerIssue {
  code: MarkerCode;
  severity: 'error' | 'warning';
  /** The annotation, by name: `Emits`, `CallsService`, `flowatlas-calls`. */
  marker: string;
  /** Its first argument, as written, when it could be read. */
  argument: string | null;
  /** Id of the annotated symbol, which is what a reader opens. */
  symbol: string;
  service: string;
  file: string;
  line: number;
  message: string;
  hint: string;
}

/** An annotation as the extractor recorded it. */
interface RecordedMarker {
  name: string;
  args: unknown[];
}

export interface MarkerOptions {
  /**
   * Rows the graph recorded, which say where reading stopped.
   *
   * An annotation is justified by one: `@Emits` on a method whose channel name
   * could not be read is the annotation doing its job, and the same annotation
   * on a method that publishes nothing is not.
   */
  unresolved?: readonly Unresolved[];
  /**
   * Symbols that are one end of some boundary a contract check looked at.
   *
   * `@ContractIgnore` on anything else excuses nothing. Left undefined when
   * contracts were not run, and then that rule is not applied at all rather
   * than applied to an empty set — which would call every one of them unused.
   */
  parties?: readonly string[];
  /** Which services claim each settings key, from the configuration. */
  envOwners?: ReadonlyMap<string, readonly string[]>;
}

const markersOn = (node: GraphNode): RecordedMarker[] => {
  const value = node.meta?.['markers'];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RecordedMarker =>
      typeof item === 'object' && item !== null && typeof (item as RecordedMarker).name === 'string',
  );
};

/** The first argument as a string, or nothing when it is not one. */
const literal = (marker: RecordedMarker, index = 0): string | undefined => {
  const value = marker.args[index];
  return typeof value === 'string' ? value : undefined;
};

/** True when an argument was there and the extractor could not read it. */
const unreadable = (marker: RecordedMarker): string | undefined => {
  for (const argument of marker.args) {
    if (typeof argument === 'object' && argument !== null && 'unresolved' in argument) {
      return String((argument as { unresolved: unknown }).unresolved);
    }
  }
  return undefined;
};

/**
 * Whether a recorded row sits at this method.
 *
 * Rows name their symbol as it is written rather than by id — `OrdersService.archive`,
 * or `OrdersService.archive -> this.channelFor('archived')` — so the label the
 * graph gives the method is the join, within the one file it is declared in.
 */
const rowsAt = (rows: readonly Unresolved[], node: GraphNode): Unresolved[] =>
  rows.filter(
    (row) =>
      (row.service ?? '') === node.repo &&
      row.file === (node.file ?? '') &&
      row.symbol !== undefined &&
      (row.symbol === node.label || row.symbol.startsWith(`${node.label} `)),
  );

/** Reasons that mean "a channel is named here and could not be read". */
const BLIND_CHANNEL = /^channel-/;

const isNode = (value: GraphNode | undefined): value is GraphNode => value !== undefined;

/**
 * Every annotation in the graph, checked against what the graph says.
 *
 * The walk is over nodes carrying `meta.markers`, so a repository whose
 * extractor does not record them yields nothing at all rather than a page of
 * false accusations — the caller is told which, and says so in the report.
 */
export const validateMarkers = (db: GraphDb, options: MarkerOptions = {}): MarkerIssue[] => {
  const rows = options.unresolved ?? [];
  const issues: MarkerIssue[] = [];
  const routesByService = new Map<string, GraphNode[]>();
  for (const entry of db.nodesByType('entry', 'http')) {
    const list = routesByService.get(entry.repo);
    if (list === undefined) routesByService.set(entry.repo, [entry]);
    else list.push(entry);
  }

  const add = (
    node: GraphNode,
    code: MarkerCode,
    marker: string,
    argument: string | undefined,
    message: string,
    hint: string,
  ): void => {
    issues.push({
      code,
      severity: ERRORS.has(code) ? 'error' : 'warning',
      marker,
      argument: argument ?? null,
      symbol: node.id,
      service: node.repo,
      file: node.file ?? '',
      line: node.line ?? 0,
      message,
      hint,
    });
  };

  for (const node of db.allNodes()) {
    const markers = markersOn(node);
    if (markers.length === 0) continue;
    const at = rowsAt(rows, node);
    const blind = at.some((row) => BLIND_CHANNEL.test(row.reason));

    for (const marker of markers) {
      const bad = unreadable(marker);
      if (bad !== undefined) {
        add(
          node,
          'marker-unknown-arg',
          marker.name,
          bad,
          `@${marker.name} on ${node.label} was given ${bad}, which could not be read`,
          'Marker arguments must be string literals, or consts from a package listed in sharedPackages.',
        );
        continue;
      }

      if (marker.name === 'Emits') {
        checkEmits(db, node, marker, blind, add);
        continue;
      }
      if (marker.name === 'Consumes') {
        checkConsumes(db, node, marker, blind || at.length > 0, add);
        continue;
      }
      if (marker.name === 'CallsService') {
        checkCallsService(db, node, marker, rows, routesByService, options.envOwners, add);
        continue;
      }
      if (marker.name === 'FlowEntry') {
        const handled = db.edgesTo(node.id, ['handles']).length > 0;
        if (!handled) {
          add(
            node,
            'marker-flowentry-not-handler',
            marker.name,
            literal(marker),
            `@FlowEntry names a flow on ${node.label}, which nothing enters the service through`,
            'Move it to the handler that starts the flow — the controller method, the bot handler, the message handler.',
          );
        }
        continue;
      }
      if (marker.name === 'ContractIgnore' && options.parties !== undefined) {
        if (!options.parties.includes(node.id)) {
          add(
            node,
            'marker-contractignore-unused',
            marker.name,
            undefined,
            `@ContractIgnore on ${node.label}, which is not on either end of any boundary`,
            'Nothing here crosses a service boundary, so nothing is being excused. Remove it, or move it to the method that makes the call.',
          );
        }
      }
    }
  }

  return issues.sort(
    (a, b) =>
      (a.service < b.service ? -1 : a.service > b.service ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
};

type Add = (
  node: GraphNode,
  code: MarkerCode,
  marker: string,
  argument: string | undefined,
  message: string,
  hint: string,
) => void;

/** The producers a method reaches directly, and the channel each publishes to. */
const producersOf = (db: GraphDb, methodId: string): Array<{ node: GraphNode; channel: string | null; viaMarker: boolean }> =>
  db
    .edgesFrom(methodId, ['calls'])
    .map((edge) => db.node(edge.to))
    .filter(isNode)
    .filter((target) => target.type === 'producer')
    .map((producer) => {
      const [emits] = db.edgesFrom(producer.id, ['emits']);
      const channel = emits === undefined ? undefined : db.node(emits.to);
      return {
        node: producer,
        channel: channel?.label ?? null,
        viaMarker: producer.meta?.['channelVia'] === 'marker',
      };
    });

/**
 * `@Emits('x')` against what the method actually publishes.
 *
 * The annotation itself puts a producer in the graph, so its own handiwork
 * cannot be the evidence for it. What counts is a producer the code put there —
 * on any channel, since one that names a different channel is still a publish —
 * or a row saying a channel was named here and could not be read, which is the
 * only reason the annotation should exist.
 */
const checkEmits = (
  db: GraphDb,
  node: GraphNode,
  marker: RecordedMarker,
  blind: boolean,
  add: Add,
): void => {
  const channel = literal(marker);
  const producers = producersOf(db, node.id);
  const fromCode = producers.filter((producer) => !producer.viaMarker);

  if (fromCode.length === 0 && !blind) {
    add(
      node,
      'marker-emits-without-emit',
      marker.name,
      channel,
      `@Emits(${JSON.stringify(channel ?? '')}) on ${node.label}, which publishes nothing`,
      'Remove the annotation, or publish from this method. Nothing else in it puts a message on any channel.',
    );
    return;
  }

  const shadowing = fromCode.find((producer) => producer.channel === channel);
  if (shadowing !== undefined) {
    add(
      node,
      'marker-emits-shadowed',
      marker.name,
      channel,
      `@Emits(${JSON.stringify(channel ?? '')}) on ${node.label} says what the code already says`,
      'Static reading finds this publish on its own, so the annotation adds nothing and will not be corrected when the channel is renamed. Remove it.',
    );
  }
};

/**
 * `@Consumes('x')` against whether anything hands this method a message.
 *
 * As with a publish, the annotation makes its own consumer, so the evidence has
 * to come from elsewhere: a consumer the code put there, a row saying a channel
 * was named here and could not be read, or — the case an in-house bus produces —
 * something in the repository that references the method, which is the
 * subscription the tool could not recognise. A method nothing calls, nothing
 * registers and nothing could not read is a handler for a message that never
 * arrives.
 */
const checkConsumes = (
  db: GraphDb,
  node: GraphNode,
  marker: RecordedMarker,
  blind: boolean,
  add: Add,
): void => {
  const channel = literal(marker);
  const consumers = db
    .edgesTo(node.id, ['handles'])
    .map((edge) => db.node(edge.from))
    .filter(isNode);
  const fromCode = consumers.filter(
    (consumer) => consumer.type !== 'consumer' || consumer.meta?.['decorator'] !== 'Consumes',
  );
  const referenced = db.edgesTo(node.id, ['calls']).length > 0;

  if (fromCode.length === 0 && !blind && !referenced) {
    add(
      node,
      'marker-consumes-without-consumer',
      marker.name,
      channel,
      `@Consumes(${JSON.stringify(channel ?? '')}) on ${node.label}, which nothing subscribes and nothing calls`,
      'Remove the annotation, or register the method as a handler. Nothing in the repository connects it to a message.',
    );
    return;
  }

  const shadowing = fromCode.find((consumer) => {
    if (consumer.type !== 'consumer') return false;
    const [consumes] = db.edgesTo(consumer.id, ['consumes']);
    return consumes !== undefined && db.node(consumes.from)?.label === channel;
  });
  if (shadowing !== undefined) {
    add(
      node,
      'marker-consumes-shadowed',
      marker.name,
      channel,
      `@Consumes(${JSON.stringify(channel ?? '')}) on ${node.label} says what the code already says`,
      'Static reading finds this subscription on its own, so the annotation adds nothing. Remove it.',
    );
  }
};

/**
 * `@CallsService('billing', 'POST /invoices')` against the target's routes.
 *
 * The linker already asked this question while joining the repositories, and
 * wrote down both ways it can be answered wrongly. Reading its rows rather than
 * asking again means the annotation is judged by the same route matching that
 * would have drawn the edge — including the global prefix and the shape of a
 * path parameter, which a second implementation here would get subtly different.
 */
const checkCallsService = (
  db: GraphDb,
  node: GraphNode,
  marker: RecordedMarker,
  rows: readonly Unresolved[],
  routesByService: ReadonlyMap<string, GraphNode[]>,
  envOwners: ReadonlyMap<string, readonly string[]> | undefined,
  add: Add,
): void => {
  const service = literal(marker, 0);
  const route = literal(marker, 1);
  const calls = db
    .edgesFrom(node.id, ['calls'])
    .map((edge) => db.node(edge.to))
    .filter(isNode)
    .filter((target) => target.type === 'http_out');
  const ids = new Set(calls.map((call) => call.id));
  const argument = service === undefined ? route : `${service}, ${route ?? ''}`.trim();

  for (const row of rows) {
    if (row.symbol === undefined || !ids.has(row.symbol)) continue;
    if (row.reason === 'marker-service-unknown') {
      add(
        node,
        'marker-callsservice-unknown-service',
        marker.name,
        argument,
        row.message ?? `@CallsService names ${service ?? '?'}, which is not a configured service`,
        row.hint ??
          `Add ${service ?? 'it'} to services[] in flowatlas.config.json, or correct the annotation.`,
      );
      return;
    }
    if (row.reason === 'marker-route-not-found') {
      const near = nearMisses(route, routesByService.get(service ?? '') ?? []);
      add(
        node,
        'marker-callsservice-route-missing',
        marker.name,
        argument,
        row.message ?? `@CallsService points at ${route ?? '?'}, which ${service ?? '?'} does not serve`,
        near.length === 0
          ? (row.hint ?? `Check ${service ?? 'the service'}'s controllers, or correct the annotation.`)
          : `Did you mean ${near.join(', ')}? Otherwise check ${service ?? 'the service'}'s controllers.`,
      );
      return;
    }
  }

  // Nothing went wrong, so the remaining question is whether it needed saying.
  const shadowed = calls.find((call) => reachableWithout(db, call, envOwners, routesByService));
  if (shadowed !== undefined) {
    add(
      node,
      'marker-callsservice-shadowed',
      marker.name,
      argument,
      `@CallsService on ${node.label} names a route the address already reaches`,
      'The settings key and the path are both readable here, so the call is joined without the annotation. Remove it before it stops agreeing with the code.',
    );
  }
};

/** Paths in the target service that differ from the one asked for only a little. */
const nearMisses = (route: string | undefined, entries: readonly GraphNode[]): string[] => {
  if (route === undefined) return [];
  const [, path] = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(route) ?? [];
  const wanted = path ?? route;
  const seen = new Set<string>();
  for (const entry of entries) {
    const method = String(entry.meta?.['method'] ?? '');
    const declared = String(entry.meta?.['path'] ?? '');
    if (declared === '') continue;
    // The verb was wrong, or one segment was: both are a typo a reader can see
    // the moment the right spelling is put in front of them.
    if (declared === wanted || segmentsDiffer(declared, wanted) === 1) {
      seen.add(`${method} ${declared}`);
    }
  }
  return [...seen].sort().slice(0, 4);
};

/** How many segments two paths differ in, or Infinity when their lengths do. */
const segmentsDiffer = (a: string, b: string): number => {
  const left = a.split('/').filter((part) => part !== '');
  const right = b.split('/').filter((part) => part !== '');
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  return left.reduce((count, part, index) => count + (part === right[index] ? 0 : 1), 0);
};

/**
 * Whether this call would reach the same route with the annotation taken off.
 *
 * Asked by redoing exactly what the linker does when there is no annotation:
 * one service claiming the settings key, a path that was read in full, and a
 * route that answers it.
 */
const reachableWithout = (
  db: GraphDb,
  call: GraphNode,
  envOwners: ReadonlyMap<string, readonly string[]> | undefined,
  routesByService: ReadonlyMap<string, GraphNode[]>,
): boolean => {
  if (envOwners === undefined) return false;
  const env = call.meta?.['baseUrlEnv'];
  const path = call.meta?.['path'];
  if (typeof env !== 'string' || typeof path !== 'string' || !wasRead(path)) return false;
  const owners = envOwners.get(env) ?? [];
  if (owners.length !== 1) return false;
  const method = String(call.meta?.['method'] ?? 'GET');
  const found = matchRoute(method, path, routesByService.get(owners[0] as string) ?? []);
  if (!isMatch(found)) return false;
  const [joined] = db.edgesFrom(call.id, ['http_calls']);
  return joined !== undefined && joined.to === found.entry.id;
};
