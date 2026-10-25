/**
 * What both exports are drawn from (P119): the services of the project, the
 * APIs each provides, and every join the graph made between a service and
 * something outside it, read once so a Backstage catalogue and a Structurizr
 * model can never disagree about which relation exists.
 *
 * A join is a crossing the linker drew - a request into another service's
 * route, a publish onto a channel and a delivery off it, a query on a table, a
 * call to a host outside the project, a function or workflow of another
 * service started by name - folded to one row per (kind, service, target,
 * label), with the edges it rests on kept so every relation an export writes
 * can be traced to the graph (I3). Only `static`, `declared` and `marker`
 * joins by default; the rest only when asked, and marked (I4).
 *
 * Pure: a graph in, rows out. Nothing here reads a file or the database.
 */
import { CONFIDENCE_RANK, type Confidence, type GraphEdge, type GraphNode, type ServiceCatalog } from '@flowatlas/core';

/** The graph an export reads: what `GraphDb.allNodes()` and `allEdges()` give back. */
export interface ExportGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** Which half of a repository a service is, as the command line's readers say (the linker names no framework). */
export type ServiceHalf = 'server' | 'browser';

/** One configured service, as an export needs it. */
export interface ExportService {
  name: string;
  /** `services[].type`: the technology a container is drawn with. */
  type: string;
  half?: ServiceHalf;
  catalog?: ServiceCatalog;
}

/** What a service is, in a catalogue's words: a server, a site in a browser, or functions only. */
export const SERVICE_KINDS = ['service', 'website', 'function'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Every kind of join an export draws, in the order relations are written. */
export const JOIN_KINDS = ['http', 'invoke', 'publish', 'consume', 'query', 'external'] as const;
export type JoinKind = (typeof JOIN_KINDS)[number];

/** Confidences an export draws without being asked (I4). */
export const EXPORT_CONFIDENCES: readonly Confidence[] = ['static', 'marker', 'declared'];

/** An edge a join rests on. */
export interface JoinEdge {
  from: string;
  to: string;
  type: string;
  confidence: Confidence;
}

/** Where a join lands. */
export interface JoinTarget {
  kind: 'service' | 'channel' | 'table' | 'external';
  /** The node id (`channel:order.created`, `table:orders#orders`, `external_api:api.example.com`); the service name for a service. */
  id: string;
  label: string;
  /** The service it belongs to: the target service, or the service whose table it is. */
  service?: string;
}

export interface ExportJoin {
  kind: JoinKind;
  /** The service the join starts in: the caller, the publisher, the consumer, the one querying. */
  from: string;
  to: JoinTarget;
  /** `POST /invoices`, `order.created`, `orders`, `POST /v1/charges`, `library-welcome-borrower`. */
  label: string;
  /** For a query: whether it writes (anything but a read, as P118's inventory counts it). */
  op?: 'read' | 'write';
  /** The strongest confidence among the edges behind it. */
  confidence: Confidence;
  /** Drawn only because `includeHeuristic` asked for it. */
  heuristic: boolean;
  edges: JoinEdge[];
}

/** An API a service provides: one per service and kind (D1), routes and channels inside its definition. */
export interface ExportApi {
  service: string;
  kind: 'openapi' | 'asyncapi';
  /** `GET /orders/:param`, or a channel name for AsyncAPI, sorted. */
  operations: string[];
}

export interface ExportModel {
  services: Array<ExportService & { kind: ServiceKind; graphId?: string }>;
  apis: ExportApi[];
  joins: ExportJoin[];
  /** Joins below the default bar that were left out (I4); zero when heuristic ones were asked for. */
  heuristicLeftOut: number;
}

export interface ExportModelOptions {
  includeHeuristic?: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ways in a server answers for itself; any of them makes a service more than its functions. */
const SERVED_KINDS: ReadonlySet<string> = new Set(['http', 'rpc', 'bot_command', 'bot_callback', 'bot_event', 'scene_step']);
/** Ways in a function is reached by. */
const FUNCTION_KINDS: ReadonlySet<string> = new Set(['invoke', 'workflow']);
/** Entries an OpenAPI document holds: routes and procedures. */
const ROUTE_KINDS: ReadonlySet<string> = new Set(['http', 'rpc']);

/**
 * What a service is: a browser's repository is a website; a server whose
 * every way in is a function or workflow reached by name (with events and
 * schedules beside them) is functions only; anything else is a service.
 */
export const serviceKindOf = (service: Pick<ExportService, 'half'>, entryKinds: readonly string[]): ServiceKind => {
  if (service.half === 'browser') return 'website';
  if (entryKinds.some((kind) => SERVED_KINDS.has(kind))) return 'service';
  return entryKinds.some((kind) => FUNCTION_KINDS.has(kind)) ? 'function' : 'service';
};

const strongest = (edges: readonly JoinEdge[]): Confidence =>
  edges.reduce<Confidence>((best, edge) => (CONFIDENCE_RANK[edge.confidence] > CONFIDENCE_RANK[best] ? edge.confidence : best), edges[0]?.confidence ?? 'runtime');

/** Whether a confidence is drawn without being asked. */
export const drawnByDefault = (confidence: Confidence): boolean => EXPORT_CONFIDENCES.includes(confidence);

/** `METHOD /path` of a route entry, as its label says it; a procedure by its label. */
const operationOf = (node: GraphNode): string => {
  const method = node.meta?.['method'];
  const path = node.meta?.['path'];
  return typeof method === 'string' && typeof path === 'string' ? `${method} ${path}` : node.label;
};

/** A request's own words, where the node says them (`POST /v1/charges`); the host otherwise. */
const requestSaid = (node: GraphNode, host: string): string => {
  const method = node.meta?.['method'];
  const path = node.meta?.['path'];
  return typeof method === 'string' && typeof path === 'string' && path !== '' ? `${method} ${path}` : host;
};

/**
 * The services, their APIs and their joins, sorted: services by name, APIs
 * by service then kind, joins by kind, service, target and label.
 */
export const exportModelOf = (graph: ExportGraph, services: readonly ExportService[], options: ExportModelOptions = {}): ExportModel => {
  const known = new Set(services.map((service) => service.name));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const entryKinds = new Map<string, string[]>();
  const routes = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (node.type !== 'entry' || !known.has(node.repo)) continue;
    const kinds = entryKinds.get(node.repo) ?? [];
    kinds.push(node.kind ?? '');
    entryKinds.set(node.repo, kinds);
    if (ROUTE_KINDS.has(node.kind ?? '')) {
      const held = routes.get(node.repo) ?? new Set<string>();
      held.add(operationOf(node));
      routes.set(node.repo, held);
    }
  }

  const folded = new Map<string, Omit<ExportJoin, 'confidence' | 'heuristic'>>();
  const add = (join: Omit<ExportJoin, 'confidence' | 'heuristic' | 'edges'>, edge: GraphEdge): void => {
    const key = [join.kind, join.from, join.to.id, join.label, join.op ?? ''].join('\u0000');
    const held = folded.get(key) ?? { ...join, edges: [] };
    held.edges.push({ from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence });
    folded.set(key, held);
  };

  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (to.type === 'external_api') {
      if (!known.has(from.repo)) continue;
      const host = typeof to.meta?.['host'] === 'string' ? (to.meta['host'] as string) : to.label;
      add({ kind: 'external', from: from.repo, to: { kind: 'external', id: to.id, label: host }, label: requestSaid(from, host) }, edge);
      continue;
    }
    switch (edge.type) {
      case 'http_calls':
      case 'hits':
        if (to.type !== 'entry' || from.repo === to.repo || !known.has(from.repo) || !known.has(to.repo)) break;
        add({ kind: 'http', from: from.repo, to: { kind: 'service', id: to.repo, label: to.repo, service: to.repo }, label: operationOf(to) }, edge);
        break;
      case 'calls':
      case 'triggers':
        // A function or workflow of another service, started by the name it is deployed under.
        if (to.type !== 'entry' || from.type === 'channel' || from.repo === to.repo || !known.has(from.repo) || !known.has(to.repo)) break;
        add({ kind: 'invoke', from: from.repo, to: { kind: 'service', id: to.repo, label: to.repo, service: to.repo }, label: to.label }, edge);
        break;
      case 'emits':
        if (to.type !== 'channel' || !known.has(from.repo)) break;
        add({ kind: 'publish', from: from.repo, to: { kind: 'channel', id: to.id, label: to.label }, label: to.label }, edge);
        break;
      case 'consumes':
        if (from.type !== 'channel' || !known.has(to.repo)) break;
        add({ kind: 'consume', from: to.repo, to: { kind: 'channel', id: from.id, label: from.label }, label: from.label }, edge);
        break;
      case 'queries': {
        if (to.type !== 'table' || !known.has(from.repo)) break;
        const op = from.meta?.['op'] === 'read' ? 'read' : 'write';
        add({ kind: 'query', from: from.repo, to: { kind: 'table', id: to.id, label: to.label, ...(known.has(to.repo) ? { service: to.repo } : {}) }, label: to.label, op }, edge);
        break;
      }
      default:
        break;
    }
  }

  const joins: ExportJoin[] = [];
  let heuristicLeftOut = 0;
  for (const join of folded.values()) {
    const confidence = strongest(join.edges);
    const heuristic = !drawnByDefault(confidence);
    if (heuristic && options.includeHeuristic !== true) {
      heuristicLeftOut += 1;
      continue;
    }
    joins.push({ ...join, confidence, heuristic, edges: [...join.edges].sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.type, b.type)) });
  }
  const kindRank = (kind: JoinKind): number => JOIN_KINDS.indexOf(kind);
  joins.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byText(a.from, b.from) || byText(a.to.id, b.to.id) || byText(a.label, b.label) || byText(a.op ?? '', b.op ?? ''));

  const published = new Map<string, Set<string>>();
  for (const join of joins) {
    if (join.kind !== 'publish') continue;
    const held = published.get(join.from) ?? new Set<string>();
    held.add(join.label);
    published.set(join.from, held);
  }

  const apis: ExportApi[] = [];
  const shaped = [...services]
    .sort((a, b) => byText(a.name, b.name))
    .map((service) => {
      const own = routes.get(service.name);
      if (own !== undefined && own.size > 0) apis.push({ service: service.name, kind: 'openapi', operations: [...own].sort(byText) });
      const channels = published.get(service.name);
      if (channels !== undefined && channels.size > 0) apis.push({ service: service.name, kind: 'asyncapi', operations: [...channels].sort(byText) });
      const graphId = nodes.has(`repo:${service.name}`) ? `repo:${service.name}` : undefined;
      return { ...service, kind: serviceKindOf(service, entryKinds.get(service.name) ?? []), ...(graphId === undefined ? {} : { graphId }) };
    });

  return { services: shaped, apis, joins, heuristicLeftOut };
};

/** The weaker of two confidences: a relation through two joins is as sure as its weaker one. */
export const weakerOf = (a: Confidence, b: Confidence): Confidence => (CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b);

/** The services each channel's publishers are in, from the joins drawn. */
export const publishersOf = (joins: readonly ExportJoin[]): Map<string, ExportJoin[]> => {
  const found = new Map<string, ExportJoin[]>();
  for (const join of joins) {
    if (join.kind !== 'publish') continue;
    const held = found.get(join.to.id) ?? [];
    held.push(join);
    found.set(join.to.id, held);
  }
  return found;
};

/** Collapse a list of labels to at most `max`, saying how many more (`+4 more`). */
export const collapseLabels = (labels: readonly string[], max: number): { text: string; cut: number } => {
  const distinct = [...new Set(labels)].sort(byText);
  if (distinct.length <= max) return { text: distinct.join(', '), cut: 0 };
  const cut = distinct.length - max;
  return { text: `${distinct.slice(0, max).join(', ')} +${cut} more`, cut };
};

export { byText as compareText };
