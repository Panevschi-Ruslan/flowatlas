import {
  isEntryId,
  isJoinEdge,
  joinIdOf,
  type AmbiguousKind,
  type GraphEdge,
  type GraphNode,
  type MeasuredAt,
  type UnmatchedKind,
} from '@flowatlas/core';
import { awsCallOf, channelLabelOf, eventBusPrefixOf, sendsOf, tableChannelOf } from './aws.js';
import type { Delivery, GraphIndex } from './match.js';
import type { ObservedSpan } from './span.js';

/**
 * AWS traffic laid over the map (P107): a span from a Lambda function, a
 * workflow step, or an SDK call to a table, a queue, a topic, a bus, a
 * stream, a bucket, a function or a workflow, credited to the node the
 * static map draws for it.
 *
 * Every credit follows P85's rule: one place that fits, or none and an
 * ambiguity row. Where the map has several joins that could be the one a
 * call ran - two writes onto one table's stream, from two functions - the
 * caller's own scope settles it: the function the span ran in, read down
 * from its handler, or the step it is part of. A join the map does not draw
 * is never made up from a call that was seen: where the target is on the map
 * and no join into it leaves the caller, the span is a blind spot of kind
 * `join`, named by what it did and the target (P110).
 */

/** What the matcher needs of the tally: `Tally` in `match.ts`. */
export interface AwsTally {
  entry(id: string, span: ObservedSpan): void;
  hit(kind: 'symbols' | 'channels', id: string, span: ObservedSpan): void;
  join(edge: GraphEdge, measured: ObservedSpan, side: MeasuredAt): void;
  miss(span: ObservedSpan, kind: UnmatchedKind, name: string): void;
  unsure(span: ObservedSpan, kind: AmbiguousKind, name: string, candidates: readonly string[]): void;
}

/** How spans of one trace hang together. */
export interface SpanTree {
  parentOf(span: ObservedSpan): ObservedSpan | undefined;
  childrenOf(span: ObservedSpan): readonly ObservedSpan[];
}

/** The unique-or-ambiguous counting `matchSpans` does for every kind of credit. */
export interface Counting {
  countJoin(span: ObservedSpan, edges: readonly GraphEdge[], name: string, side: MeasuredAt): GraphEdge | undefined;
  countOne(
    span: ObservedSpan,
    kind: AmbiguousKind,
    name: string,
    nodes: readonly GraphNode[],
    credit: (node: GraphNode) => void,
  ): void;
}

export interface AwsMatcher {
  /** The span is a function's invocation, a workflow's run or step, or an AWS SDK call. */
  claims(span: ObservedSpan): boolean;
  match(span: ObservedSpan): void;
}

/** How far up a trace the span a call ran in is looked for. */
const MAX_HOPS = 64;
/** How many nodes a function's scope holds at most, read down from its handler. */
const SCOPE_NODES = 2000;

/** Triggers that hand a function the records of a stream or a queue, with no message span of their own. */
const DELIVERED: ReadonlySet<string> = new Set(['datasource', 'pubsub']);

const isState = (node: GraphNode | undefined): boolean => node?.type === 'function' && node.kind === 'state';

export const matchAws = (index: GraphIndex, tally: AwsTally, tree: SpanTree, counting: Counting): AwsMatcher => {
  const nodeOf = (id: string): GraphNode | undefined => index.nodes.get(id);
  const ofService = (span: ObservedSpan) => (node: GraphNode): boolean =>
    span.service === undefined || !index.services.has(span.service) || node.repo === span.service;

  // --- where a call ran: its scope --------------------------------------------

  const functionScopes = new Map<string, ReadonlySet<string>>();
  /** What a function's code reaches, from its handler down its calls, not into another way in or a step. */
  const functionScope = (name: string): ReadonlySet<string> => {
    let scope = functionScopes.get(name);
    if (scope !== undefined) return scope;
    const seen = new Set<string>();
    const queue = (index.invokes.get(name) ?? []).flatMap((entry) =>
      (index.from.get(entry.id) ?? []).filter((edge) => edge.type === 'handles').map((edge) => edge.to),
    );
    while (queue.length > 0 && seen.size < SCOPE_NODES) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of index.from.get(id) ?? []) {
        if (edge.type === 'calls' && !isEntryId(edge.to) && !isState(nodeOf(edge.to))) queue.push(edge.to);
      }
    }
    scope = seen;
    functionScopes.set(name, scope);
    return scope;
  };

  /** A step, and what its task does: the next step is not part of it. */
  const stateScope = (state: GraphNode): ReadonlySet<string> =>
    new Set([
      state.id,
      ...(index.from.get(state.id) ?? []).filter((edge) => edge.type === 'calls' && !isState(nodeOf(edge.to))).map((edge) => edge.to),
    ]);

  /** The one step a span is, when the map has it; several of one name in two services are none. */
  const stateOf = (span: ObservedSpan): GraphNode | undefined => {
    if (span.state === undefined || span.workflow === undefined) return undefined;
    const found = (index.states.get(`${span.workflow}/${span.state}`) ?? []).filter(ofService(span));
    return found.length === 1 ? found[0] : undefined;
  };

  /** The nodes a call may have been made from: the step or the function it ran in, nearest first. */
  const scopeOf = (span: ObservedSpan): ReadonlySet<string> | undefined => {
    let at = tree.parentOf(span);
    for (let hops = 0; at !== undefined && hops < MAX_HOPS; hops += 1, at = tree.parentOf(at)) {
      const state = stateOf(at);
      if (state !== undefined) return stateScope(state);
      if (at.faas !== undefined && (at.kind === 'server' || at.kind === 'consumer')) return functionScope(at.faas);
    }
    return span.faas === undefined ? undefined : functionScope(span.faas);
  };

  /**
   * The joins among `edges` the caller made: those that leave its scope when
   * the map says where it ran, and none that leave anywhere else (I3); only a
   * call whose scope is unknown falls back to its service, as P85 counts.
   */
  const fromCaller = (span: ObservedSpan, edges: readonly GraphEdge[]): GraphEdge[] => {
    const scope = scopeOf(span);
    if (scope !== undefined && scope.size > 0) return edges.filter((edge) => scope.has(edge.from));
    const keep = ofService(span);
    return edges.filter((edge) => {
      const source = nodeOf(edge.from);
      return source !== undefined && keep(source);
    });
  };

  // --- ways in: a function, a workflow, a step ---------------------------------

  /** Whatever a delivery ran, credited on the callee's side: the channel's message, both joins, an event entry. */
  const delivered = (span: ObservedSpan, delivery: Delivery, creditChannel: boolean): void => {
    if (creditChannel) tally.hit('channels', delivery.channel.id, span);
    tally.join(delivery.consumes, span, 'callee');
    tally.join(delivery.wayIn, span, 'callee');
    // The `invoke` entry is the function's own span's to credit; an `event` entry is the delivery's.
    if (delivery.entry.kind !== 'invoke') tally.entry(delivery.entry.id, span);
  };

  const deliveriesOf = (span: ObservedSpan, rows: readonly Delivery[], name: string, creditChannel: boolean): void => {
    const keep = ofService(span);
    const fits = rows.filter((row) => keep(row.entry) && (span.faas === undefined || row.fn === span.faas));
    if (fits.length === 1) delivered(span, fits[0]!, creditChannel);
    else if (fits.length > 1) {
      tally.unsure(span, 'join', name, fits.map(({ consumes }) => joinIdOf(consumes.from, consumes.type, consumes.to)));
    }
  };

  /** A function ran: its `invoke` entry, the join from the step that invoked it, and a stream that delivered to it. */
  const invocation = (span: ObservedSpan): void => {
    const name = span.faas!;
    const entries = (index.invokes.get(name) ?? []).filter(ofService(span));
    if (entries.length === 0) {
      tally.miss(span, 'function', name);
      return;
    }
    counting.countOne(span, 'entry', name, entries, (entry) => tally.entry(entry.id, span));
    const parent = tree.parentOf(span);
    const step = parent === undefined ? undefined : stateOf(parent);
    if (parent !== undefined && step !== undefined) {
      const into = new Set(entries.map((entry) => entry.id));
      counting.countJoin(parent, (index.from.get(step.id) ?? []).filter((edge) => into.has(edge.to)), name, 'caller');
    }
    // A stream or a queue that hands over records leaves no message span: the trigger and the map say which.
    const consumed = tree.childrenOf(span).some((child) => child.kind === 'consumer' && child.destination !== undefined);
    if (span.trigger !== undefined && DELIVERED.has(span.trigger) && !consumed) {
      deliveriesOf(span, index.deliveries.byFunction.get(name) ?? [], name, true);
    }
  };

  /** A workflow ran: its `workflow` entry. */
  const run = (span: ObservedSpan): void => {
    const name = span.workflow!;
    const entries = (index.workflows.get(name) ?? []).filter(ofService(span));
    if (entries.length === 0) tally.miss(span, 'workflow', name);
    else counting.countOne(span, 'entry', name, entries, (entry) => tally.entry(entry.id, span));
  };

  /** A step ran: its node, when the map has a step of that name in that workflow, and never its name otherwise. */
  const step = (span: ObservedSpan): void => {
    const machine = span.workflow!;
    const found = (index.states.get(`${machine}/${span.state!}`) ?? []).filter(ofService(span));
    if (found.length > 0) {
      counting.countOne(span, 'symbol', `${machine}/${span.state!}`, found, (node) => tally.hit('symbols', node.id, span));
    } else if ((index.workflows.get(machine) ?? []).length > 0) tally.miss(span, 'state', `${machine}/?`);
    else tally.miss(span, 'workflow', machine);
  };

  /** A message taken off a channel: the channel, and the one subscriber that runs the function. */
  const consume = (span: ObservedSpan): void => {
    const label = channelLabelOf(span);
    if (label === undefined) return;
    const channel = index.channels.get(label);
    if (channel === undefined) {
      tally.miss(span, 'messaging', label);
      return;
    }
    tally.hit('channels', channel.id, span);
    deliveriesOf(span, index.deliveries.byChannel.get(channel.id) ?? [], label, false);
  };

  // --- SDK calls ----------------------------------------------------------------

  /**
   * The join a call ran, or a blind spot when the target is on the map and no
   * join into it leaves the caller: the map draws the target and not the way
   * there (P110).
   */
  const joinFrom = (span: ObservedSpan, edges: readonly GraphEdge[], name: string, said: string): GraphEdge | undefined => {
    const joins = fromCaller(span, edges).filter(isJoinEdge);
    if (joins.length === 0) {
      tally.miss(span, 'join', said);
      return undefined;
    }
    return counting.countJoin(span, joins, name, 'caller');
  };

  /** A send onto `channel`: its message, and the `emits` join from the caller. */
  const emitTo = (span: ObservedSpan, channel: GraphNode): void => {
    tally.hit('channels', channel.id, span);
    const emits = (index.to.get(channel.id) ?? []).filter((edge) => edge.type === 'emits');
    joinFrom(span, emits, channel.label, `send ${channel.label}`);
  };

  const channelsOnBus = new Map<string, GraphNode[]>();
  const busChannels = (prefix: string): GraphNode[] => {
    let found = channelsOnBus.get(prefix);
    if (found === undefined) {
      found = [...index.channels.values()].filter((channel) => channel.label.startsWith(prefix));
      channelsOnBus.set(prefix, found);
    }
    return found;
  };

  /**
   * Events put on a bus. A span names the bus and seldom the event, so it is
   * the bus's one channel, or the one channel the caller's own code puts
   * events on; with several either way it is counted on none (I3).
   */
  const putEvents = (span: ObservedSpan, prefix: string): void => {
    const channels = busChannels(prefix);
    const bus = prefix.slice(0, -1);
    if (channels.length === 0) {
      tally.miss(span, 'messaging', bus);
      return;
    }
    const scope = scopeOf(span);
    const own = scope === undefined
      ? []
      : channels.filter((channel) =>
          (index.to.get(channel.id) ?? []).some((edge) => edge.type === 'emits' && scope.has(edge.from)),
        );
    const one = own.length === 1 ? own : channels.length === 1 ? channels : [];
    if (one.length === 1) emitTo(span, one[0]!);
    else tally.unsure(span, 'channel', bus, (own.length > 1 ? own : channels).map((channel) => channel.id));
  };

  const send = (span: ObservedSpan): void => {
    const prefix = eventBusPrefixOf(span);
    if (prefix !== undefined) {
      putEvents(span, prefix);
      return;
    }
    const label = channelLabelOf(span);
    if (label === undefined) return;
    const channel = index.channels.get(label);
    // A bucket is a channel only where something is notified of its writes: a write to any other is no message.
    if (channel !== undefined) emitTo(span, channel);
    else if (span.transport !== 's3') tally.miss(span, 'messaging', label);
  };

  /** A call into a table: the table, the step's query of it, and a write onto its stream. */
  const tableCall = (span: ObservedSpan, table: string, writes: boolean): void => {
    const nodes = (index.tables.get(table.toLowerCase()) ?? []).filter(ofService(span));
    const channel = index.channels.get(tableChannelOf(table));
    if (nodes.length === 0 && channel === undefined) {
      tally.miss(span, 'table', table);
      return;
    }
    if (nodes.length > 0) {
      counting.countOne(span, 'table', table, nodes, (node) => {
        tally.hit('symbols', node.id, span);
        const queries = fromCaller(span, (index.to.get(node.id) ?? []).filter((edge) => edge.type === 'queries'));
        if (queries.length === 1) tally.hit('symbols', queries[0]!.from, span);
      });
    }
    if (writes && channel !== undefined) emitTo(span, channel);
  };

  /** A function invoked or a workflow started by name: the join from the caller's call site into its entry. */
  const start = (span: ObservedSpan, name: string, entries: readonly GraphNode[], kind: UnmatchedKind): void => {
    if (entries.length === 0) {
      tally.miss(span, kind, name);
      return;
    }
    const into = entries.flatMap((entry) => (index.to.get(entry.id) ?? []).filter(isJoinEdge));
    const joined = joinFrom(span, into, name, `${kind === 'workflow' ? 'start' : 'invoke'} ${name}`);
    // The call site the join leaves from, as an http call's is (a step invokes from itself).
    if (joined !== undefined && !isState(nodeOf(joined.from))) tally.hit('symbols', joined.from, span);
  };

  // --- a step's call that names no target ------------------------------------

  /** The step a span was made by, nearest first, when the map has it. */
  const stepAbove = (span: ObservedSpan): GraphNode | undefined => {
    let at = tree.parentOf(span);
    for (let hops = 0; at !== undefined && hops < MAX_HOPS; hops += 1, at = tree.parentOf(at)) {
      const state = stateOf(at);
      if (state !== undefined) return state;
    }
    return undefined;
  };

  /** The nodes of one kind a step's own task reaches, each once. */
  const reachedBy = (state: GraphNode, edgeType: string, wanted: (node: GraphNode) => boolean): GraphNode[] => {
    const found = new Map<string, GraphNode>();
    for (const id of stateScope(state)) {
      for (const edge of index.from.get(id) ?? []) {
        const node = edge.type === edgeType ? nodeOf(edge.to) : undefined;
        if (node !== undefined && wanted(node)) found.set(node.id, node);
      }
    }
    return [...found.values()];
  };

  /**
   * A call a workflow's history records without its target (P108: a task's
   * parameters are never read): the one target of its kind the step's own
   * task reaches on the map, the way a step's scope settles any other call.
   * None, or several, is credited to nothing (I3).
   */
  const STEP_TARGETS: Readonly<Record<'table' | 'channel' | 'invoke' | 'workflow', (span: ObservedSpan, state: GraphNode, sends: boolean) => void>> = {
    invoke: (span, state) => {
      const into = (index.from.get(state.id) ?? []).filter((edge) => edge.type === 'calls' && nodeOf(edge.to)?.kind === 'invoke');
      if (into.length === 1) counting.countJoin(span, into, nodeOf(into[0]!.to)!.label, 'caller');
    },
    workflow: (span, state) => {
      const into = (index.from.get(state.id) ?? []).filter((edge) => edge.type === 'calls' && nodeOf(edge.to)?.kind === 'workflow');
      if (into.length === 1) counting.countJoin(span, into, nodeOf(into[0]!.to)!.label, 'caller');
    },
    channel: (span, state) => {
      const channels = reachedBy(state, 'emits', (node) => node.type === 'channel');
      if (channels.length === 1) emitTo(span, channels[0]!);
    },
    table: (span, state, sends) => {
      const tables = reachedBy(state, 'queries', (node) => node.type === 'table');
      if (tables.length === 1) tableCall(span, tables[0]!.label, sends);
    },
  };

  /** Whether a call says what it was made on: a table, a destination, a function, a workflow. */
  const namesTarget = (span: ObservedSpan, lookup: keyof typeof STEP_TARGETS): boolean =>
    lookup === 'table'
      ? (span.tables ?? []).length > 0
      : lookup === 'channel'
        ? channelLabelOf(span) !== undefined || eventBusPrefixOf(span) !== undefined
        : lookup === 'invoke'
          ? span.invokes !== undefined
          : span.workflow !== undefined;

  const sdkCall = (span: ObservedSpan): void => {
    const call = awsCallOf(span);
    if (call === undefined) {
      tally.miss(span, 'cloud', span.rpc!);
      return;
    }
    const sends = sendsOf(span);
    if (!namesTarget(span, call.lookup)) {
      const state = (sends || call.lookup === 'table') ? stepAbove(span) : undefined;
      if (state !== undefined) STEP_TARGETS[call.lookup](span, state, sends);
      return;
    }
    switch (call.lookup) {
      case 'table':
        for (const table of span.tables ?? []) tableCall(span, table, sends);
        return;
      case 'channel':
        if (sends) send(span);
        return;
      case 'invoke':
        if (sends) start(span, span.invokes!, index.invokes.get(span.invokes!) ?? [], 'function');
        return;
      case 'workflow':
        if (sends) start(span, span.workflow!, index.workflows.get(span.workflow!) ?? [], 'workflow');
        return;
    }
  };

  return {
    claims: (span) =>
      (span.awsOp !== undefined && span.rpc !== undefined) ||
      (span.state !== undefined && span.workflow !== undefined) ||
      (span.kind === 'server' && (span.faas ?? span.workflow) !== undefined) ||
      (span.kind === 'consumer' && span.transport !== undefined && span.destination !== undefined),
    match: (span) => {
      if (span.awsOp !== undefined && span.rpc !== undefined) sdkCall(span);
      else if (span.state !== undefined && span.workflow !== undefined) step(span);
      else if (span.kind === 'server' && span.faas !== undefined) invocation(span);
      else if (span.kind === 'server') run(span);
      else consume(span);
    },
  };
};
