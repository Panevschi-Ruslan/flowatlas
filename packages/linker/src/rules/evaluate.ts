/**
 * Architecture rules, checked over the joined graph (P114).
 *
 * Pure: a graph and the rules in, a report out, no database and no source.
 * The CLI's `rules`, `doctor` and `diff` and the MCP server's `check_rules`
 * all call this, so a violation reads the same on every surface.
 *
 * What a rule is read over is the graph's own edges, re-read as **hops**: who
 * does something (the actor) to what (the target). A request, a call between
 * services, a publish, a query and a start are hops from their source node to
 * their target. A consume is the one turned round: the graph draws it from the
 * channel to the handler, and a rule reads it the way a dependency runs, the
 * handler depending on the channel. Only edges the graph holds are hops (I3).
 *
 * Four shapes (D1), each a Strategy in `SHAPES`:
 *
 * - `forbid` - `from` must not reach `to`. `direct` (D3, the default): one hop.
 *   `transitive`: any path forward, walked breadth first from every node
 *   `from` selects and stopped at the first node `to` selects on each path,
 *   so a rule over a whole service reports where a path enters it, not every
 *   method behind that.
 * - `only` - `direct` (the default): a hop into `to` from anything `from`
 *   does not select. `transitive` (P203): any path into `to` that does not go
 *   through `from`, walked back from `to` through whatever `from` itself
 *   reaches and reported at the nearest node outside that (`walkBack`).
 * - `tags` - a hop from a service tagged `source` into a service carrying none
 *   of `mayReach`. A publish joins nobody in particular; a consume joins the
 *   services that publish onto the channel.
 * - `reachable` - with `must: true`, no path from `from` reaches `to` any more
 *   (one violation); with `must: false`, every path that does.
 *
 * A hop inside one service - a service reading its own table, a call - is
 * checked only when the rule asks for it: its `to` names a `table`, or its
 * `via` names the hop's kind. Otherwise "only gateway calls orders" would be
 * broken by orders reading its own table.
 */
import {
  CONFIDENCE_RANK,
  compileAccepted,
  DEFAULT_RULE_VIA,
  matchesRoutePattern,
  routeOfSymbol,
  routePatternOf,
  SELECTOR_KEYS,
  shapeOfRule,
  type AcceptedGap,
  type Confidence,
  type GapLike,
  type GraphEdge,
  type GraphNode,
  type RuleConfig,
  type RuleEdgeKind,
  type RuleSelector,
  type RuleSeverity,
} from '@flowatlas/core';
import { weakest } from '../analysis/graph.js';
import {
  RULES_FORMAT_VERSION,
  type RuleGraph,
  type RuleHop,
  type RuleNote,
  type RulePlace,
  type RuleResult,
  type RulesReport,
  type RuleUnchecked,
  type RuleViolation,
} from './types.js';

export interface EvaluateOptions {
  /** `accepted.json`'s entries: a `rule:<name>` entry excuses the violations it covers. */
  accepted?: readonly AcceptedGap[];
  /** The most nodes one transitive walk visits before it stops (I9). Default 5,000. */
  maxWalk?: number;
}

/** How far a transitive walk goes before it says it stopped. */
export const DEFAULT_RULE_WALK = 5000;

/** The edges a path is walked forward along, as `get_flow` walks them. */
const FORWARD: readonly string[] = ['handles', 'calls', 'caches', 'http_calls', 'hits', 'emits', 'consumes', 'queries', 'triggers'];

/** Edges that only carry a walk inside one service, never a crossing a rule names. */
const PLUMBING: ReadonlySet<string> = new Set(['handles', 'calls', 'caches']);

/** The kinds a hop can be, and the edge of the graph it is read from. */
const HOP_KINDS: ReadonlySet<string> = new Set(['http_calls', 'hits', 'emits', 'consumes', 'queries', 'triggers', 'calls']);

/** The node types a way in is. */
const WAY_IN: ReadonlySet<string> = new Set(['entry', 'consumer']);

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const SEVERITY_ORDER: Readonly<Record<RuleSeverity, number>> = { error: 0, warning: 1, info: 2 };

/** `*` and `**` are any run of characters; nothing else is special. */
const globOf = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split(/\*+/).map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** A hop: who does something, to what, by which edge. */
interface Hop {
  kind: string;
  actor: string;
  target: string;
  edge: GraphEdge;
}

/** The graph indexed once for every rule. */
interface Index {
  nodes: Map<string, GraphNode>;
  /** Every node id, ascending: iterate this, never a Map. */
  order: string[];
  hops: Hop[];
  forward: Map<string, GraphEdge[]>;
  /** The same edges by the node they arrive at, for walking a path back from its end. */
  backward: Map<string, GraphEdge[]>;
  /** Each channel's publishers, by channel id. */
  producers: Map<string, string[]>;
  tags: Readonly<Record<string, readonly string[]>>;
  partial: ReadonlySet<string>;
  services: string[];
}

const add = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

const indexOf = (graph: RuleGraph): Index => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const hops: Hop[] = [];
  const forward = new Map<string, GraphEdge[]>();
  const backward = new Map<string, GraphEdge[]>();
  const producers = new Map<string, string[]>();
  const edges = [...graph.edges].sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.type, b.type));
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    if (FORWARD.includes(edge.type)) {
      add(forward, edge.from, edge);
      add(backward, edge.to, edge);
    }
    if (edge.type === 'emits') add(producers, edge.to, edge.from);
    if (!HOP_KINDS.has(edge.type)) continue;
    hops.push(
      edge.type === 'consumes'
        ? { kind: edge.type, actor: edge.to, target: edge.from, edge }
        : { kind: edge.type, actor: edge.from, target: edge.to, edge },
    );
  }
  const services = [...new Set(graph.nodes.filter((node) => node.type !== 'channel').map((node) => node.repo))].sort(byText);
  return {
    nodes,
    order: [...nodes.keys()].sort(byText),
    hops,
    forward,
    backward,
    producers,
    tags: graph.tags,
    partial: new Set(graph.partial ?? []),
    services,
  };
};

/** A channel belongs to no service: the same channel is one node whoever publishes it (I6). */
const serviceOfNode = (node: GraphNode): string | null => (node.type === 'channel' ? null : node.repo);

const channelName = (node: GraphNode): string => (node.id.startsWith('channel:') ? node.id.slice('channel:'.length) : node.label);

/** How each selector key tests a node (a Strategy by key); keys are ANDed. */
const KEY_TESTS: Readonly<Record<string, (pattern: string, index: Index) => (node: GraphNode) => boolean>> = {
  service: (pattern) => {
    const glob = globOf(pattern);
    return (node) => serviceOfNode(node) !== null && glob.test(node.repo);
  },
  tag: (pattern, index) => {
    const glob = globOf(pattern);
    return (node) => serviceOfNode(node) !== null && (index.tags[node.repo] ?? []).some((tag) => glob.test(tag));
  },
  entry: (pattern) => {
    const glob = globOf(pattern);
    return (node) => WAY_IN.has(node.type) && (glob.test(node.id) || glob.test(node.label));
  },
  table: (pattern) => {
    const glob = globOf(pattern);
    return (node) => node.type === 'table' && glob.test(node.label);
  },
  channel: (pattern) => {
    const glob = globOf(pattern);
    return (node) => node.type === 'channel' && glob.test(channelName(node));
  },
  route: (pattern) => {
    const route = routePatternOf(pattern);
    return (node) => {
      if (node.type !== 'entry' || node.kind !== 'http') return false;
      const at = routeOfSymbol(node.label);
      return at !== undefined && matchesRoutePattern(route, at.method, at.path);
    };
  },
  type: (pattern) => {
    const glob = globOf(pattern);
    return (node) => glob.test(node.type);
  },
};

type NodeTest = (node: GraphNode) => boolean;

const testOf = (selector: RuleSelector, index: Index): NodeTest => {
  const tests = SELECTOR_KEYS.flatMap((key) => {
    const pattern = selector[key];
    return pattern === undefined ? [] : [KEY_TESTS[key]!(pattern, index)];
  });
  return (node) => tests.every((test) => test(node));
};

/** A selector as a reader wrote it: `service web · tag frontend`. */
export const saySelector = (selector: RuleSelector): string =>
  SELECTOR_KEYS.filter((key) => selector[key] !== undefined)
    .map((key) => `${key} ${selector[key] as string}`)
    .join(' · ');

const count = (index: Index, test: NodeTest): number => index.order.filter((id) => test(index.nodes.get(id)!)).length;

/** Close names, for a typo: the known values sorted by how few edits away they are. */
const nearest = (wanted: string, known: readonly string[]): string[] => {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[b.length]!;
  };
  return [...known]
    .map((value) => ({ value, far: distance(wanted, value) }))
    .filter((item) => item.far <= Math.max(2, Math.floor(wanted.length / 3)))
    .sort((a, b) => a.far - b.far || byText(a.value, b.value))
    .slice(0, 3)
    .map((item) => item.value);
};

/** The values a selector key could have named, for the message about a typo. */
const knownFor = (key: string, index: Index): string[] => {
  if (key === 'service') return index.services;
  if (key === 'tag') return [...new Set(Object.values(index.tags).flat())].sort(byText);
  if (key === 'table') return [...new Set(index.order.map((id) => index.nodes.get(id)!).filter((node) => node.type === 'table').map((node) => node.label))].sort(byText);
  if (key === 'channel') return index.order.map((id) => index.nodes.get(id)!).filter((node) => node.type === 'channel').map(channelName);
  return [];
};

/**
 * Why one side of a rule selects nothing, when it does: the first key that
 * on its own names nothing, or the keys together. Undefined when it selects
 * something.
 */
const whyNothing = (selector: RuleSelector, index: Index): { selector: string; message: string } | undefined => {
  if (count(index, testOf(selector, index)) > 0) return undefined;
  for (const key of SELECTOR_KEYS) {
    const pattern = selector[key];
    if (pattern === undefined) continue;
    if (count(index, KEY_TESTS[key]!(pattern, index)) > 0) continue;
    const near = nearest(pattern, knownFor(key, index));
    return {
      selector: `${key} ${pattern}`,
      message: `${key} ${JSON.stringify(pattern)} names nothing in this graph${near.length === 0 ? '' : `; did you mean ${near.join(', ')}?`}`,
    };
  }
  return { selector: saySelector(selector), message: `${saySelector(selector)} together name nothing in this graph` };
};

/** What a hop does, in words: `requests`, `writes`. */
const doesSay = (hop: Hop, index: Index): string => {
  if (hop.kind === 'queries') {
    const op = index.nodes.get(hop.actor)?.meta?.['op'];
    return typeof op === 'string' ? `${op}s` : 'queries';
  }
  return (
    { http_calls: 'calls', hits: 'requests', emits: 'publishes to', consumes: 'consumes', triggers: 'starts', calls: 'calls' } as Record<string, string>
  )[hop.kind] ?? hop.kind;
};

/** A node as a sentence names it: `orders GET /orders/:param`, `table orders (billing)`, `channel order.created`. */
const nodeSay = (node: GraphNode | undefined): string => {
  if (node === undefined) return '?';
  // A query's label is what it does, which the sentence says beside it.
  if (node.type === 'db_query') return node.repo;
  if (node.type === 'channel') return `channel ${channelName(node)}`;
  if (node.type === 'table') return `table ${node.label} (${node.repo})`;
  return `${node.repo} ${node.label}`;
};

const placeOf = (node: GraphNode | undefined): RulePlace | undefined =>
  node?.file === undefined
    ? undefined
    : { service: node.repo, file: node.file, ...(node.line === undefined ? {} : { line: node.line }) };

const hopOf = (edge: GraphEdge): RuleHop => ({ from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence });

const isGuess = (level: Confidence): boolean => CONFIDENCE_RANK[level] <= CONFIDENCE_RANK.heuristic;

/** Whether a hop crosses: between two services, or onto a channel. */
const crosses = (hop: Hop, index: Index): boolean => {
  const actor = index.nodes.get(hop.actor)!;
  const target = index.nodes.get(hop.target)!;
  return serviceOfNode(target) === null || serviceOfNode(actor) === null || actor.repo !== target.repo;
};

/** Whether a rule looks at a hop: its kind is one `via` names, and it crosses unless the rule asks for one that does not. */
const looksAt = (hop: Hop, rule: { via?: readonly string[] | undefined; to?: RuleSelector }, index: Index): boolean => {
  const via = rule.via ?? DEFAULT_RULE_VIA;
  if (!via.includes(hop.kind)) return false;
  return crosses(hop, index) || rule.to?.table !== undefined || (rule.via?.includes(hop.kind) ?? false);
};

/** What a shape finds, before the rule's own fields are put on each. */
type Found = Omit<RuleViolation, 'rule' | 'shape' | 'severity' | 'note' | 'key' | 'heuristic' | 'partial'>;

const fromHop = (hop: Hop, index: Index, message: string, toService?: string | null): Found => {
  const actor = index.nodes.get(hop.actor);
  const target = index.nodes.get(hop.target)!;
  const at = placeOf(actor);
  return {
    from: hop.actor,
    to: hop.target,
    fromService: actor?.repo ?? '',
    toService: toService === undefined ? serviceOfNode(target) : toService,
    via: hop.kind,
    path: [hopOf(hop.edge)],
    ...(at === undefined ? {} : { at }),
    confidence: hop.edge.confidence,
    message,
  };
};

interface Walked {
  found: Found[];
  cut: boolean;
}

/**
 * Every path forward from what `from` selects to the first node `to` selects
 * on it, breadth first from all of them at once, one path per node reached.
 * Crossings are followed only by the kinds `via` allows; plumbing inside a
 * service always is. A path that never leaves its service is not one.
 */
const walkForward = (
  index: Index,
  from: NodeTest,
  to: NodeTest,
  via: readonly string[],
  maxWalk: number,
): Walked => {
  const sources = index.order.filter((id) => from(index.nodes.get(id)!));
  const parent = new Map<string, { node: string; edge: GraphEdge } | null>();
  const origin = new Map<string, string>();
  const queue: string[] = [];
  for (const id of sources) {
    parent.set(id, null);
    origin.set(id, id);
    queue.push(id);
  }
  const found: Found[] = [];
  let cut = false;
  for (let at = 0; at < queue.length; at += 1) {
    const id = queue[at]!;
    for (const edge of index.forward.get(id) ?? []) {
      if (parent.has(edge.to)) continue;
      if (!PLUMBING.has(edge.type) && !via.includes(edge.type)) continue;
      if (parent.size >= maxWalk) {
        cut = true;
        break;
      }
      parent.set(edge.to, { node: id, edge });
      const start = origin.get(id)!;
      origin.set(edge.to, start);
      const node = index.nodes.get(edge.to)!;
      if (to(node) && !from(node)) {
        const path: GraphEdge[] = [];
        for (let step = parent.get(edge.to); step != null; step = parent.get(step.node)) path.unshift(step.edge);
        const crossing = path.find((hop) => !PLUMBING.has(hop.type)) ?? path[0]!;
        const startNode = index.nodes.get(start)!;
        // A path that stays in one service is not one a rule between services is about.
        if (serviceOfNode(node) !== null && node.repo === startNode.repo && path.every((hop) => PLUMBING.has(hop.type) || hop.type === 'queries')) continue;
        const near = crossing.type === 'consumes' ? crossing.to : crossing.from;
        const place = placeOf(index.nodes.get(near));
        found.push({
          from: start,
          to: edge.to,
          fromService: startNode.repo,
          toService: serviceOfNode(node),
          via: crossing.type,
          path: path.map(hopOf),
          ...(place === undefined ? {} : { at: place }),
          confidence: weakest(path.map((hop) => hop.confidence)),
          message: `${nodeSay(startNode)} reaches ${nodeSay(node)} in ${path.length} hop${path.length === 1 ? '' : 's'}`,
        });
        continue;
      }
      queue.push(edge.to);
    }
    if (cut) break;
  }
  return { found, cut };
};

/** What a transitive `only` is walked with, beyond its two sides. */
interface BackRule {
  via: readonly string[];
  op?: string | undefined;
  /** Whether a path inside one service counts: the rule's `to` names a table, or its `via` names a kind on the path. */
  inService: (path: readonly GraphEdge[]) => boolean;
  /** How the rule says who may: `service orders`. */
  owner: string;
}

/**
 * Every path into what `to` selects that does not go through what `from`
 * selects: a transitive `only` (P203).
 *
 * Whatever `from` reaches acts for it - a workflow it starts, a route it
 * calls, a handler of a channel it publishes onto - so "only billing writes
 * payments" holds when billing writes them through a workflow of its own.
 * Each path is walked back from a `to` node through what acts for `from`, and
 * stops at the nearest node that `from` neither selects nor reaches: that
 * node is where the path starts (`from`), the one that reached `to` other than
 * through `from`, and what is in front of it (a gateway route in front of a
 * service that breaks the rule) is not walked: the nearest one answers for
 * the path. A path back that arrives at `from` is `from`'s own and ends there.
 * A channel is no one's (I6): the walk goes on to its publishers.
 *
 * One path per node reached, the shortest, as forward. When working out what
 * `from` reaches stops at `maxWalk`, nothing is said: every node past the cut
 * would be a violation it is not.
 */
const walkBack = (index: Index, from: NodeTest, to: NodeTest, rule: BackRule, maxWalk: number): Walked => {
  const follows = (edge: GraphEdge): boolean => PLUMBING.has(edge.type) || rule.via.includes(edge.type);
  const side = new Set<string>();
  const ahead: string[] = [];
  for (const id of index.order) {
    if (!from(index.nodes.get(id)!)) continue;
    side.add(id);
    ahead.push(id);
  }
  for (let at = 0; at < ahead.length; at += 1) {
    for (const edge of index.forward.get(ahead[at]!) ?? []) {
      if (side.has(edge.to) || !follows(edge)) continue;
      if (side.size >= maxWalk) return { found: [], cut: true };
      side.add(edge.to);
      ahead.push(edge.to);
    }
  }

  // Toward the nearest `to` node: the edge out of each node walked back to, null on a `to` node.
  const next = new Map<string, GraphEdge | null>();
  const back: string[] = [];
  for (const id of index.order) {
    const node = index.nodes.get(id)!;
    if (!to(node) || from(node)) continue;
    next.set(id, null);
    back.push(id);
  }
  const found: Found[] = [];
  let cut = false;
  for (let at = 0; at < back.length && !cut; at += 1) {
    const id = back[at]!;
    const intoTo = next.get(id) === null;
    for (const edge of index.backward.get(id) ?? []) {
      if (next.has(edge.from) || !follows(edge)) continue;
      // `op` is about the hop that arrives: a table's query that does what it says.
      if (intoTo && rule.op !== undefined && !(edge.type === 'queries' && index.nodes.get(edge.from)?.meta?.['op'] === rule.op)) continue;
      const node = index.nodes.get(edge.from)!;
      if (from(node)) continue;
      if (next.size >= maxWalk) {
        cut = true;
        break;
      }
      next.set(edge.from, edge);
      if (side.has(edge.from) || node.type === 'channel') {
        back.push(edge.from);
        continue;
      }
      const path: GraphEdge[] = [];
      for (let step: GraphEdge | null | undefined = edge; step != null; step = next.get(step.to)) path.push(step);
      const end = index.nodes.get(path[path.length - 1]!.to)!;
      // A path that stays in one service is a rule's only when it asks for one, as a direct hop is.
      const inOne = serviceOfNode(end) !== null && end.repo === node.repo && path.every((hop) => PLUMBING.has(hop.type) || hop.type === 'queries');
      if (inOne && !rule.inService(path)) continue;
      const crossing = path.find((hop) => !PLUMBING.has(hop.type)) ?? path[0]!;
      const place = placeOf(node);
      const said =
        path.length === 1
          ? `${nodeSay(node)} ${doesSay({ kind: edge.type, actor: edge.from, target: edge.to, edge }, index)} ${nodeSay(end)}`
          : `${nodeSay(node)} reaches ${nodeSay(end)} in ${path.length} hops`;
      found.push({
        from: edge.from,
        to: end.id,
        fromService: node.repo,
        toService: serviceOfNode(end),
        via: crossing.type,
        path: path.map(hopOf),
        ...(place === undefined ? {} : { at: place }),
        confidence: weakest(path.map((hop) => hop.confidence)),
        message: `${said}, which only ${rule.owner} may`,
      });
    }
  }
  return { found, cut };
};

/** What each shape needs to say about itself: the sides it selects by and how it finds violations. */
interface ShapeRule {
  /** The sides that must each select something, with the test for each. */
  sides(rule: RuleConfig, index: Index): Array<{ side: string; check: () => { selector: string; message: string } | undefined; test?: NodeTest }>;
  /** The services the rule names, for `rule-over-partial-read`. */
  names(rule: RuleConfig, index: Index): string[];
  find(rule: RuleConfig, index: Index, options: Required<EvaluateOptions>): Walked;
}

const servicesSelected = (index: Index, selector: RuleSelector): string[] => {
  if (selector.service === undefined && selector.tag === undefined) return [];
  const test = testOf({ ...(selector.service === undefined ? {} : { service: selector.service }), ...(selector.tag === undefined ? {} : { tag: selector.tag }) }, index);
  return [...new Set(index.order.map((id) => index.nodes.get(id)!).filter(test).map((node) => node.repo))].sort(byText);
};

const sidesOf = (from: RuleSelector, to: RuleSelector, index: Index) => [
  { side: 'from', check: () => whyNothing(from, index), test: testOf(from, index) },
  { side: 'to', check: () => whyNothing(to, index), test: testOf(to, index) },
];

const servicesTagged = (index: Index, pattern: string): string[] => {
  const glob = globOf(pattern);
  return index.services.filter((service) => (index.tags[service] ?? []).some((tag) => glob.test(tag)));
};

const SHAPES: Readonly<Record<string, ShapeRule>> = {
  forbid: {
    sides: (rule, index) => sidesOf(rule.forbid!.from, rule.forbid!.to, index),
    names: (rule, index) => [...servicesSelected(index, rule.forbid!.from), ...servicesSelected(index, rule.forbid!.to)],
    find: (rule, index, options) => {
      const shape = rule.forbid!;
      const from = testOf(shape.from, index);
      const to = testOf(shape.to, index);
      if (shape.reach === 'transitive') return walkForward(index, from, to, shape.via ?? DEFAULT_RULE_VIA, options.maxWalk);
      const found = index.hops
        .filter((hop) => looksAt(hop, shape, index) && from(index.nodes.get(hop.actor)!) && to(index.nodes.get(hop.target)!))
        .map((hop) => fromHop(hop, index, `${nodeSay(index.nodes.get(hop.actor))} ${doesSay(hop, index)} ${nodeSay(index.nodes.get(hop.target))}`));
      return { found, cut: false };
    },
  },
  only: {
    sides: (rule, index) => sidesOf(rule.only!.from, rule.only!.to, index),
    names: (rule, index) => [...servicesSelected(index, rule.only!.from), ...servicesSelected(index, rule.only!.to)],
    find: (rule, index, options) => {
      const shape = rule.only!;
      const from = testOf(shape.from, index);
      const to = testOf(shape.to, index);
      if (shape.reach === 'transitive') {
        return walkBack(
          index,
          from,
          to,
          {
            via: shape.via ?? DEFAULT_RULE_VIA,
            op: shape.op,
            inService: (path) => shape.to.table !== undefined || path.some((hop) => shape.via?.includes(hop.type as RuleEdgeKind) ?? false),
            owner: saySelector(shape.from),
          },
          options.maxWalk,
        );
      }
      const found = index.hops
        .filter((hop) => looksAt(hop, shape, index) && to(index.nodes.get(hop.target)!) && !from(index.nodes.get(hop.actor)!))
        .filter((hop) => shape.op === undefined || (hop.kind === 'queries' && index.nodes.get(hop.actor)?.meta?.['op'] === shape.op))
        .map((hop) =>
          fromHop(hop, index, `${nodeSay(index.nodes.get(hop.actor))} ${doesSay(hop, index)} ${nodeSay(index.nodes.get(hop.target))}, which only ${saySelector(shape.from)} may`),
        );
      return { found, cut: false };
    },
  },
  tags: {
    sides: (rule, index) => {
      const shape = rule.tags!;
      const inTagged = (tag: string): NodeTest => {
        const services = new Set(servicesTagged(index, tag));
        return (node) => serviceOfNode(node) !== null && services.has(node.repo);
      };
      return [
        {
          side: 'source',
          test: inTagged(shape.source),
          check: () =>
            servicesTagged(index, shape.source).length > 0
              ? undefined
              : { selector: `tag ${shape.source}`, message: `no service carries tag ${JSON.stringify(shape.source)}` },
        },
        ...shape.mayReach
          .filter((tag) => tag !== '*')
          .map((tag) => ({
            side: `mayReach ${tag}`,
            test: inTagged(tag),
            check: () =>
              servicesTagged(index, tag).length > 0 ? undefined : { selector: `tag ${tag}`, message: `no service carries tag ${JSON.stringify(tag)}, which mayReach names` },
          })),
      ];
    },
    names: (rule, index) => [rule.tags!.source, ...rule.tags!.mayReach.filter((tag) => tag !== '*')].flatMap((tag) => servicesTagged(index, tag)),
    find: (rule, index) => {
      const shape = rule.tags!;
      const sources = new Set(servicesTagged(index, shape.source));
      const allowed = (service: string): boolean =>
        shape.mayReach.includes('*') || shape.mayReach.some((tag) => servicesTagged(index, tag).includes(service));
      const found: Found[] = [];
      for (const hop of index.hops) {
        if (!((shape.via ?? DEFAULT_RULE_VIA) as readonly string[]).includes(hop.kind) || hop.kind === 'emits') continue;
        const actor = index.nodes.get(hop.actor)!;
        if (!sources.has(actor.repo)) continue;
        // A consume joins the services that publish onto the channel; anything else joins its target's.
        const joined =
          hop.kind === 'consumes'
            ? (index.producers.get(hop.target) ?? []).map((id) => ({ id, service: index.nodes.get(id)!.repo }))
            : [{ id: hop.target, service: index.nodes.get(hop.target)!.repo }];
        for (const end of joined) {
          if (end.service === actor.repo || allowed(end.service)) continue;
          const reached = index.nodes.get(end.id);
          const via = `, and ${end.service} carries none of ${shape.mayReach.join(', ')}`;
          found.push({
            ...fromHop(hop, index, `${actor.repo} (${shape.source}) ${doesSay(hop, index)} ${nodeSay(index.nodes.get(hop.target))}${hop.kind === 'consumes' ? ` from ${nodeSay(reached)}` : ''}${via}`, end.service),
            to: end.id,
          });
        }
      }
      return { found, cut: false };
    },
  },
  reachable: {
    sides: (rule, index) => sidesOf(rule.reachable!.from, rule.reachable!.to, index),
    names: (rule, index) => [...servicesSelected(index, rule.reachable!.from), ...servicesSelected(index, rule.reachable!.to)],
    find: (rule, index, options) => {
      const shape = rule.reachable!;
      const from = testOf(shape.from, index);
      const to = testOf(shape.to, index);
      const walked = walkForward(index, from, to, DEFAULT_RULE_VIA, options.maxWalk);
      if (!shape.must) return walked;
      if (walked.found.length > 0 || walked.cut) return { found: [], cut: walked.cut };
      const start = index.order.find((id) => from(index.nodes.get(id)!))!;
      const end = index.order.find((id) => to(index.nodes.get(id)!))!;
      // A channel is in no file of its own: a missing path is said where its side starts, or nowhere.
      const place = index.nodes.get(start)!.type === 'channel' ? undefined : placeOf(index.nodes.get(start));
      return {
        found: [
          {
            from: start,
            to: end,
            fromService: index.nodes.get(start)!.repo,
            toService: serviceOfNode(index.nodes.get(end)!),
            via: 'none',
            path: [],
            ...(place === undefined ? {} : { at: place }),
            confidence: 'static',
            message: `nothing ${saySelector(shape.from)} selects reaches ${saySelector(shape.to)} any more`,
          },
        ],
        cut: false,
      };
    },
  },
};

/**
 * A node as a key can hold it without a line (D5): a call, a request, a
 * publish or a query is a place in a file, and its id ends `:line:column`, so
 * it is named by its file and what it says instead (`…/orders-api.ts~GET
 * /orders/:param`). Everything else is named by its id, which has no line.
 */
export const stableNodeKey = (id: string, label?: string): string => {
  const cut = id.replace(/:\d+:\d+$/, '');
  return cut === id || label === undefined ? cut : `${cut}~${label.replace(/\s+/g, ' ').trim()}`;
};

/** The key a violation is held by in a baseline and a diff: no line (D5). */
export const ruleKeyOf = (rule: string, from: string, to: string): string => `rule|${rule}|${from}|${to}`;

/** What `accept rule:<name>` matches a violation on: the rule, the service it starts in, the file it crosses in, and a route when one end is one. */
export const ruleGapOf = (violation: Pick<RuleViolation, 'rule' | 'fromService' | 'at' | 'from' | 'to'>, nodes?: ReadonlyMap<string, GraphNode>): GapLike => {
  const route = [violation.to, violation.from]
    .map((id) => nodes?.get(id))
    .find((node) => node?.type === 'entry' && node.kind === 'http');
  return {
    reason: `rule:${violation.rule}`,
    service: violation.fromService,
    ...(violation.at === undefined ? {} : { file: violation.at.file }),
    ...(route === undefined ? {} : { symbol: route.label }),
  };
};

const order = (a: RuleViolation, b: RuleViolation): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  byText(a.rule, b.rule) ||
  byText(a.fromService, b.fromService) ||
  byText(a.at?.file ?? '', b.at?.file ?? '') ||
  (a.at?.line ?? 0) - (b.at?.line ?? 0) ||
  byText(a.key, b.key);

/**
 * Every rule checked against one graph.
 *
 * A rule one of whose sides selects nothing is `unchecked` and not evaluated
 * (I3: a typo is never a pass, and a typo on the `from` side of an `only`
 * would otherwise make every hop a violation). A rule over a service read in
 * part is evaluated and says so on each answer.
 */
export const evaluateRules = (graph: RuleGraph, rules: readonly RuleConfig[], options: EvaluateOptions = {}): RulesReport => {
  const index = indexOf(graph);
  const settings: Required<EvaluateOptions> = { accepted: options.accepted ?? [], maxWalk: options.maxWalk ?? DEFAULT_RULE_WALK };
  const accepted = compileAccepted(settings.accepted.filter((entry) => entry.reason.startsWith('rule:')));
  const results: RuleResult[] = [];
  const violations: RuleViolation[] = [];
  const excused: RuleViolation[] = [];
  const unchecked: RuleUnchecked[] = [];
  const notes: RuleNote[] = [];

  for (const rule of rules) {
    const shapeName = shapeOfRule(rule);
    const shape = SHAPES[shapeName]!;
    const base = { name: rule.name, shape: shapeName, severity: rule.severity, ...(rule.note === undefined ? {} : { note: rule.note }) };
    const sides = shape.sides(rule, index);
    const matched = Object.fromEntries(
      sides.filter((side) => side.test !== undefined).map((side) => [side.side, count(index, side.test!)]),
    );
    const missing = sides.flatMap((side) => {
      const why = side.check();
      return why === undefined ? [] : [{ side: side.side, ...why }];
    });
    if (missing.length > 0) {
      for (const item of missing) {
        unchecked.push({
          rule: rule.name,
          shape: shapeName,
          severity: rule.severity,
          key: `rule|${rule.name}|unchecked|${item.side}`,
          reason: 'rule-matches-nothing',
          side: item.side,
          selector: item.selector,
          message: `not checked (${item.side}): ${item.message}`,
        });
      }
      results.push({ ...base, status: 'unchecked', matched, violations: 0, excused: 0 });
      continue;
    }

    const partial = [...new Set(shape.names(rule, index))].filter((service) => index.partial.has(service)).sort(byText);
    for (const service of partial) {
      notes.push({
        rule: rule.name,
        reason: 'rule-over-partial-read',
        service,
        message: `${service} was read in part, so a crossing it makes may be missing from this answer`,
      });
    }

    const walked = shape.find(rule, index, settings);
    const seen = new Map<string, RuleViolation>();
    for (const found of walked.found) {
      const key = ruleKeyOf(
        rule.name,
        stableNodeKey(found.from, index.nodes.get(found.from)?.label),
        stableNodeKey(found.to, index.nodes.get(found.to)?.label),
      );
      const violation: RuleViolation = {
        rule: rule.name,
        shape: shapeName,
        severity: rule.severity,
        ...(rule.note === undefined ? {} : { note: rule.note }),
        key,
        ...found,
        heuristic: isGuess(found.confidence),
        ...(partial.length === 0 ? {} : { partial }),
      };
      const before = seen.get(key);
      // One violation per pair of ends: the surest of the hops between them.
      if (before === undefined || CONFIDENCE_RANK[violation.confidence] > CONFIDENCE_RANK[before.confidence]) seen.set(key, violation);
    }
    let held = 0;
    let excusing = 0;
    for (const violation of seen.values()) {
      const entry = accepted.match(ruleGapOf(violation, index.nodes));
      if (entry === undefined) {
        violations.push(violation);
        held += 1;
      } else {
        excused.push({ ...violation, excusedBy: entry.note });
        excusing += 1;
      }
    }
    results.push({
      ...base,
      status: held > 0 ? 'broken' : 'held',
      matched,
      violations: held,
      excused: excusing,
      ...(walked.cut ? { walkCut: true as const } : {}),
    });
  }

  violations.sort(order);
  excused.sort(order);
  const level = (severity: RuleSeverity): number => violations.filter((item) => item.severity === severity).length;
  return {
    rulesFormatVersion: RULES_FORMAT_VERSION,
    rules: results,
    violations,
    excused,
    unchecked,
    notes,
    summary: {
      rules: results.length,
      held: results.filter((result) => result.status === 'held').length,
      broken: results.filter((result) => result.status === 'broken').length,
      unchecked: results.filter((result) => result.status === 'unchecked').length,
      errors: level('error'),
      warnings: level('warning'),
      infos: level('info'),
      heuristic: violations.filter((item) => item.heuristic).length,
      excused: excused.length,
    },
  };
};

/** The levels a run can be failed at, as `contracts --fail-on` has them. */
export const RULE_FAIL_LEVELS = ['none', 'error', 'warning'] as const;
export type RuleFailLevel = (typeof RULE_FAIL_LEVELS)[number];

/** Whether a violation, or an unchecked rule, is at or above a level. */
const atLeast = (severity: RuleSeverity, level: RuleFailLevel): boolean =>
  level !== 'none' && SEVERITY_ORDER[severity] <= SEVERITY_ORDER[level];

/**
 * What fails a run at a level: violations at or above it (a guessed one only
 * with `failOnHeuristic`, D4), and rules at or above it that could not be
 * checked (I3: a typo is never a pass).
 */
export const ruleFailures = (
  report: Pick<RulesReport, 'violations' | 'unchecked'>,
  level: RuleFailLevel,
  failOnHeuristic = false,
): { violations: RuleViolation[]; unchecked: RuleUnchecked[] } => ({
  violations: report.violations.filter((item) => atLeast(item.severity, level) && (failOnHeuristic || !item.heuristic)),
  unchecked: report.unchecked.filter((item) => atLeast(item.severity, level)),
});
