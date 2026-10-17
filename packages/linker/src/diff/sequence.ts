/**
 * A walk from a way in, read as a sequence of messages between participants,
 * and two such sequences compared (P116).
 *
 * A tree of what an entry reaches answers "what does this touch"; a reviewer
 * of a branch asks "what does this request do now that it did not do before",
 * and that question is about the order things happen in and which repository
 * each happens in. So the tree is flattened into the steps that cross from one
 * participant to another - a request into another service, a publish onto a
 * channel and the handler that takes it, a query against a table - in the call
 * order the walk already uses, and the two sides of a diff are matched step by
 * step on what each step means rather than on the line it sits on (D2).
 *
 * Everything here is pure: a tree in, steps out; two step lists in, a list of
 * changes out. The walk and the graph are the caller's (I7), so `flowatlas
 * diff`, `flowatlas flow --format sequence` and the docs of P120 read one
 * sequence the same way.
 */
import { loopOfEdge, runsBeside, type Confidence, type GraphEdge } from '@flowatlas/core';
import type { TypeChange } from './types.js';

/**
 * What a step is.
 *
 * `enters` the request that starts the flow, from whoever calls the way in;
 * `calls` a call between two participants (between classes, at class detail);
 * the crossings by the edge type that makes them; `stop` a place the walk could
 * not follow, drawn where it stopped (I3).
 */
export const STEP_KINDS = [
  'enters',
  'calls',
  'http_calls',
  'hits',
  'emits',
  'consumes',
  'queries',
  'caches',
  'triggers',
  'stop',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** What a participant is, which decides how a diagram draws it. */
export const PARTICIPANT_KINDS = ['caller', 'service', 'class', 'channel', 'table', 'store', 'external'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

/** One per service by default (D1); one per class inside a service at `class` detail. */
export const SEQUENCE_DETAILS = ['service', 'class'] as const;
export type SequenceDetail = (typeof SEQUENCE_DETAILS)[number];

export interface Participant {
  id: string;
  label: string;
  kind: ParticipantKind;
  /** The service it is drawn inside: its own for a service, a class or a table; none for a channel. */
  service?: string;
}

/**
 * Steps run once per item of a loop, or beside their siblings (P64, P69). The
 * id groups the steps of one loop or one `Promise.all`; `branch` tells the
 * branches of one apart. Never part of what a step is matched by.
 */
export interface StepGroup {
  kind: 'loop' | 'par';
  id: string;
  label: string;
  branch?: number;
}

export interface SequenceStep {
  kind: StepKind;
  /** Participant ids. A `stop` is at one participant: `from` and `to` are the same. */
  from: string;
  to: string;
  /** `POST /invoices`, `order.created`, `write orders`; the reason, for a `stop`. */
  label: string;
  confidence: Confidence;
  /** Where the step is written, repo-relative in the service of `from`. */
  file?: string;
  line?: number;
  /** Type ids it carries and gets back, as the edge says. */
  params?: string[];
  returns?: string;
  /**
   * Type ids the receiving end declares it takes, where they are not what the
   * edge carries: the body the handler of a route or a channel reads. A
   * request whose sender did not change still changes when its receiver now
   * wants a field it is not sent.
   */
  takes?: string[];
  group?: StepGroup;
}

export interface Sequence {
  participants: Participant[];
  steps: SequenceStep[];
}

export const STEP_STATUSES = ['same', 'added', 'removed', 'changed'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** A step of a diff: what it is on the side it is read from (head, or base for a removed one), and what changed. */
export interface SequenceChange extends SequenceStep {
  status: StepStatus;
  /** For a `changed` step: what changed, `body: +channel (required)`. */
  note?: string;
}

/** Which side a flow was walked on: both, or only the one that has the way in. */
export const FLOW_SIDES = ['both', 'head', 'base'] as const;
export type FlowSide = (typeof FLOW_SIDES)[number];

/** One way in whose flow a diff walked on both sides, as `diff.json` holds it (format 3). */
export interface FlowChange {
  entry: string;
  label: string;
  service: string;
  side: FlowSide;
  /** How many changed nodes of the report the way in reaches: the rank it was drawn in. */
  reaches: number;
  participants: Participant[];
  steps: SequenceChange[];
  counts: Record<StepStatus, number>;
  /** What the walk left out, on the side that left more out (I9). */
  truncated?: string;
}

/* ── The tree, as much of it as this reads ── */

/**
 * A row of a walk: `FlowNode` of `@flowatlas/mcp`, read structurally so the
 * linker does not depend on the server.
 */
export interface SequenceTree {
  node: {
    id: string;
    type: string;
    label: string;
    service?: string;
    loc?: string;
    kind?: string;
    meta?: Record<string, unknown>;
    ref?: true;
  };
  edge?: { type: string; confidence: string; params?: string[]; returns?: string };
  children: readonly SequenceTree[];
}

/**
 * What the graph edge behind a row says about where and how it runs, which a
 * row of the tree does not carry. `order` is a workflow's place for the step
 * (`meta.order`); `together` the line of the `Promise.all` it is in.
 */
export interface SequenceSite {
  file?: string;
  line?: number;
  order?: number;
  loop?: { kind: string; line: number };
  concurrent?: boolean;
  together?: number;
}

/** `T` is the caller's row type (a `FlowNode`), handed back to the two lookups as it was given. */
export interface SequenceOptions<T extends SequenceTree = SequenceTree> {
  detail?: SequenceDetail;
  /** The site of the edge behind a row; without it the order is the tree's and nothing is grouped. */
  siteOf?: (row: T) => SequenceSite | undefined;
  /** Why the walk cannot see past a row (the reason of its gap row), or nothing. */
  stopOf?: (row: T) => string | undefined;
}

/** A graph edge's site, as `sequenceOf` reads it: the same marks the Steps view reads (`sites.ts`). */
export const siteOfEdge = (edge: GraphEdge): SequenceSite => {
  const loop = loopOfEdge(edge);
  const order = edge.meta?.['order'];
  const together = (edge.meta?.['together'] as { line?: unknown } | undefined)?.line;
  return {
    ...(edge.file === undefined ? {} : { file: edge.file }),
    ...(edge.line === undefined ? {} : { line: edge.line }),
    ...(typeof order === 'number' && Number.isFinite(order) ? { order } : {}),
    ...(loop === undefined ? {} : { loop }),
    ...(runsBeside(edge) ? { concurrent: true } : {}),
    ...(typeof together === 'number' ? { together } : {}),
  };
};

/** The nodes a call reaches on its way out of a method: they stand where the method is, and the crossing leaves from them. */
const CALL_SITES: ReadonlySet<string> = new Set(['http_out', 'producer', 'db_query', 'cache_op', 'ui_api_call']);

/** Who calls a way in, by the kind of way in it is. */
const CALLER_LABEL: Readonly<Record<string, string>> = {
  http: 'client',
  rpc: 'client',
  bot_command: 'user',
  bot_callback: 'user',
  bot_event: 'user',
  scene_step: 'user',
  event: 'broker',
  cron: 'scheduler',
};

const CALLER = 'caller';

const CONFIDENCES: ReadonlySet<string> = new Set(['static', 'marker', 'declared', 'heuristic', 'runtime']);

const confidenceOf = (value: string | undefined): Confidence =>
  value !== undefined && CONFIDENCES.has(value) ? (value as Confidence) : 'static';

/** `src/a.ts:12` → file and line. */
const placeOf = (loc: string | undefined): { file?: string; line?: number } => {
  if (loc === undefined) return {};
  const match = /^(.*):(\d+)$/.exec(loc);
  if (match === null) return { file: loc };
  return { file: match[1] as string, line: Number(match[2]) };
};

/** Call order: what runs as written (by line) first, then what a workflow orders, as `buildFlowTree` walks. */
const byCallOrder = (sites: ReadonlyMap<SequenceTree, SequenceSite | undefined>) => (a: SequenceTree, b: SequenceTree): number => {
  const x = sites.get(a);
  const y = sites.get(b);
  const ordered = Number(x?.order !== undefined) - Number(y?.order !== undefined);
  if (ordered !== 0) return ordered;
  if (x?.order !== undefined && y?.order !== undefined && x.order !== y.order) return x.order - y.order;
  return (x?.line ?? Number.MAX_SAFE_INTEGER) - (y?.line ?? Number.MAX_SAFE_INTEGER);
};

/** The key a step is matched by across two revisions: its meaning, never its line (D2). */
export const stepKeyOf = (step: Pick<SequenceStep, 'kind' | 'from' | 'to' | 'label'>): string =>
  `${step.kind}\u0000${step.from}\u0000${step.to}\u0000${step.label}`;

/**
 * The steps of a walk, in call order (P66), each from the participant control
 * is in to the one the step reaches.
 *
 * The flow starts with the request into the way in, from whoever calls it.
 * A call into a method in the same participant is not a step (the diagram is
 * about crossings), but what that method does is walked. A row the walk
 * already wrote elsewhere (`ref`) is a step and is not walked again. A row the
 * walk could not see past is a `stop` at the participant it stopped in, never
 * left out (I3). Steps in a loop or a `Promise.all` keep the group, and the
 * same step twice in a row in one loop body is one step.
 */
export const sequenceOf = <T extends SequenceTree>(tree: T, options: SequenceOptions<T> = {}): Sequence => {
  const detail = options.detail ?? 'service';
  const participants = new Map<string, Participant>();
  const steps: SequenceStep[] = [];

  const meet = (participant: Participant): string => {
    if (!participants.has(participant.id)) participants.set(participant.id, participant);
    return participant.id;
  };

  const serviceParticipant = (service: string): Participant => ({ id: service, label: service, kind: 'service', service });

  const classOf = (node: SequenceTree['node']): string | undefined => {
    if (node.type !== 'method') return undefined;
    const dot = node.label.lastIndexOf('.');
    return dot <= 0 ? undefined : node.label.slice(0, dot);
  };

  /** Where a node that runs code stands: its service, or its class at class detail. */
  const bodyOf = (row: SequenceTree): Participant => {
    const service = row.node.service ?? row.node.label;
    if (detail === 'service') return serviceParticipant(service);
    const own = classOf(row.node);
    // A way in, a consumer, a function: drawn as the class its handler is in,
    // so `handles` into the controller is not a step of its own.
    const handler = own === undefined ? row.children.find((child) => classOf(child.node) !== undefined) : undefined;
    const name = own ?? (handler === undefined ? undefined : classOf(handler.node));
    return name === undefined ? serviceParticipant(service) : { id: `${service}/${name}`, label: name, kind: 'class', service };
  };

  const storeOf = (node: SequenceTree['node']): Participant => {
    const service = node.service ?? '';
    return node.type === 'table'
      ? { id: `table:${service}/${node.label}`, label: `${node.label} (table)`, kind: 'table', ...(service === '' ? {} : { service }) }
      : { id: `store:${service}/${node.label}`, label: `${node.label} (store)`, kind: 'store', ...(service === '' ? {} : { service }) };
  };

  const channelOf = (node: SequenceTree['node']): Participant => {
    const kind = node.meta?.['channelKind'];
    return { id: `channel:${node.label}`, label: typeof kind === 'string' ? `${node.label} (${kind})` : node.label, kind: 'channel' };
  };

  /** Where a crossing lands. */
  const targetOf = (row: SequenceTree): Participant => {
    if (row.node.type === 'channel') return channelOf(row.node);
    if (row.node.type === 'table') return storeOf(row.node);
    if (row.node.type === 'external_api') return { id: `external:${row.node.label}`, label: row.node.label, kind: 'external' };
    return bodyOf(row);
  };

  const push = (step: SequenceStep): void => {
    const last = steps[steps.length - 1];
    // The same step twice in one loop body is one step run per item.
    if (last !== undefined && step.group?.kind === 'loop' && last.group?.id === step.group.id && stepKeyOf(last) === stepKeyOf(step)) return;
    steps.push(step);
  };

  const carried = (edge: SequenceTree['edge'] | undefined): Pick<SequenceStep, 'params' | 'returns'> => ({
    ...(edge?.params === undefined || edge.params.length === 0 ? {} : { params: [...edge.params] }),
    ...(edge?.returns === undefined ? {} : { returns: edge.returns }),
  });

  /** What the handler a crossing reaches declares it takes: the `handles` under a route, the method under a consumer. */
  const takesOf = (row: SequenceTree): Pick<SequenceStep, 'takes'> => {
    const handler = row.children.find((child) => child.edge?.type === 'handles') ?? (row.node.type === 'consumer' ? row.children[0] : undefined);
    const params = handler?.edge?.params;
    return params === undefined || params.length === 0 ? {} : { takes: [...params] };
  };

  const stop = (at: string, reason: string, row: SequenceTree, group: StepGroup | undefined): void =>
    push({
      kind: 'stop',
      from: at,
      to: at,
      label: reason,
      confidence: confidenceOf(row.edge?.confidence),
      ...placeOf(row.node.loc),
      ...(group === undefined ? {} : { group }),
    });

  const sites = new Map<SequenceTree, SequenceSite | undefined>();
  const siteOf = (row: SequenceTree): SequenceSite | undefined => {
    if (!sites.has(row)) sites.set(row, options.siteOf?.(row as T));
    return sites.get(row);
  };

  /** The loop or `Promise.all` a row's own edge is in, when it is not already inside one. */
  const groupOf = (row: SequenceTree, parent: SequenceTree, index: number): StepGroup | undefined => {
    const site = siteOf(row);
    if (site?.loop !== undefined) {
      return { kind: 'loop', id: `${parent.node.id}|loop|${site.loop.kind}|${site.loop.line}`, label: `each item (${site.loop.kind})` };
    }
    if (site?.concurrent === true) {
      return { kind: 'par', id: `${parent.node.id}|par|${site.together ?? ''}`, label: 'together', branch: index };
    }
    return undefined;
  };

  const visit = (row: SequenceTree, at: string, parent: SequenceTree, inherited: StepGroup | undefined, index: number): void => {
    const group = inherited ?? groupOf(row, parent, index);
    const type = row.edge?.type;
    if (row.node.type === 'missing') {
      stop(at, 'not in the graph', row, group);
      return;
    }
    if (type === 'reads_config') return;

    const site = siteOf(row);
    const fromSite = CALL_SITES.has(parent.node.type) ? parent : undefined;
    const where = (): Pick<SequenceStep, 'file' | 'line'> => {
      if (site?.line !== undefined) return { ...(site.file === undefined ? {} : { file: site.file }), line: site.line };
      return placeOf((fromSite ?? row).node.loc);
    };
    const message = (kind: StepKind, to: Participant, label: string): string => {
      const id = meet(to);
      push({
        kind,
        from: at,
        to: id,
        label,
        confidence: confidenceOf(row.edge?.confidence),
        ...where(),
        ...carried(row.edge?.params !== undefined || row.edge?.returns !== undefined ? row.edge : fromSite?.edge),
        ...(kind === 'calls' ? {} : takesOf(row)),
        ...(group === undefined ? {} : { group }),
      });
      return id;
    };

    let next = at;
    switch (type) {
      case 'handles':
      case 'calls': {
        if (CALL_SITES.has(row.node.type)) break;
        const to = bodyOf(row);
        next = to.id === at ? at : message('calls', to, row.node.label);
        break;
      }
      case 'http_calls':
      case 'hits':
        next = message(type, targetOf(row), fromSite?.node.label ?? row.node.label);
        break;
      case 'emits':
        next = message('emits', channelOf(row.node), row.node.label);
        break;
      case 'consumes':
        next = message('consumes', bodyOf(row), parent.node.type === 'channel' ? parent.node.label : row.node.label);
        break;
      case 'queries':
      case 'caches':
        next = message(type, storeOf(row.node), fromSite?.node.label ?? row.node.label);
        break;
      case 'triggers':
        next = message('triggers', targetOf(row), row.node.label);
        break;
      default:
        break;
    }

    const reason = options.stopOf?.(row as T);
    if (reason !== undefined) stop(next, reason, row, group);
    if (row.node.ref === true) return;
    childrenOf(row).forEach((child, index2) => visit(child, next, row, group, index2));
  };

  const childrenOf = (row: SequenceTree): SequenceTree[] => {
    if (options.siteOf === undefined) return [...row.children];
    for (const child of row.children) siteOf(child);
    return [...row.children].sort(byCallOrder(sites));
  };

  const start = bodyOf(tree);
  const handles = tree.children.find((child) => child.edge?.type === 'handles');
  meet({ id: CALLER, label: CALLER_LABEL[tree.node.kind ?? ''] ?? (tree.node.type === 'ui_action' ? 'user' : 'caller'), kind: 'caller' });
  const first = meet(start);
  push({
    kind: 'enters',
    from: CALLER,
    to: first,
    label: tree.node.label,
    confidence: 'static',
    ...placeOf(tree.node.loc),
    ...carried(handles?.edge),
  });
  const rootStop = options.stopOf?.(tree);
  if (rootStop !== undefined) stop(first, rootStop, tree, undefined);
  childrenOf(tree).forEach((child, index) => visit(child, first, tree, undefined, index));

  return { participants: [...participants.values()], steps };
};

/* ── Two sequences compared ── */

/** A field change said short, for the note on a changed step. */
const FIELD_SAY: Readonly<Record<string, (change: TypeChange['fieldDiff'][number]) => string>> = {
  added: (change) => `+${change.field}${change.optional ? '' : ' (required)'}`,
  removed: (change) => `-${change.field}`,
  type: (change) => `${change.field}: ${change.base ?? '?'} → ${change.head ?? '?'}`,
  optionality: (change) => `${change.field} now ${change.optional ? 'optional' : 'required'}`,
};

/**
 * What each changed type changed by, said short: the note a step carrying it
 * gets (`+channel (required)`). A type whose hash moved with no field diff
 * says only that its shape changed.
 */
export const typeNotesOf = (changed: readonly TypeChange[]): Map<string, string> =>
  new Map(
    changed.map((change) => [
      change.id,
      change.fieldDiff.length === 0
        ? 'shape changed'
        : change.fieldDiff.map((field) => (FIELD_SAY[field.change] ?? ((item) => item.field))(field)).join(', '),
    ]),
  );

export interface DiffSequenceOptions {
  /** By type id, what a changed type changed by (`typeNotesOf`): a step carrying one is `changed`. */
  typeNotes?: ReadonlyMap<string, string>;
}

const shortType = (id: string): string => id.slice(id.lastIndexOf('#') + 1);

/** What differs between one step and the same step on the other side, or nothing. */
const changeOf = (base: SequenceStep, head: SequenceStep, notes: ReadonlyMap<string, string>): string | undefined => {
  const said: string[] = [];
  const listed = (ids: readonly string[] | undefined): string => (ids === undefined || ids.length === 0 ? 'nothing' : ids.map(shortType).join(', '));
  const noted = new Set<string>();
  for (const [word, was, now] of [
    ['body', base.params, head.params],
    ['takes', base.takes, head.takes],
  ] as const) {
    if ((was ?? []).join() !== (now ?? []).join()) {
      // Short names, unless two types of one name in different places are what changed.
      const short = listed(was) !== listed(now);
      const say = (ids: readonly string[] | undefined): string => (short ? listed(ids) : ids === undefined || ids.length === 0 ? 'nothing' : ids.join(', '));
      said.push(`${word}: ${say(was)} → ${say(now)}`);
      continue;
    }
    for (const id of now ?? []) {
      const note = notes.get(id);
      if (note === undefined || noted.has(id)) continue;
      noted.add(id);
      said.push(`body: ${note}`);
    }
  }
  if ((base.returns ?? '') !== (head.returns ?? '')) {
    said.push(`response: ${base.returns === undefined ? 'nothing' : shortType(base.returns)} → ${head.returns === undefined ? 'nothing' : shortType(head.returns)}`);
  } else if (head.returns !== undefined) {
    const note = notes.get(head.returns);
    if (note !== undefined) said.push(`response: ${note}`);
  }
  if (base.confidence !== head.confidence) said.push(`confidence: ${base.confidence} → ${head.confidence}`);
  return said.length === 0 ? undefined : said.join('; ');
};

/**
 * Two sequences of one way in, step by step: each `same`, `added`, `removed`
 * or `changed`.
 *
 * Steps are matched by what they mean (`stepKeyOf`: from, to, kind, label),
 * never by line, with a longest common subsequence, so a step inserted in the
 * middle is one addition and not a cascade of everything after it (D2). A
 * matched step is `changed` when what it carries or how sure the graph is of
 * it differs, or a type it carries changed shape. Removed steps come before
 * the added ones that took their place, as a diff reads; each step is the
 * head's, a removed one the base's. Participants are the head's, then those
 * only the base had.
 */
export const diffSequences = (base: Sequence, head: Sequence, options: DiffSequenceOptions = {}): { participants: Participant[]; steps: SequenceChange[] } => {
  const notes = options.typeNotes ?? new Map<string, string>();
  const a = base.steps.map(stepKeyOf);
  const b = head.steps.map(stepKeyOf);
  // lcs[i][j]: the longest common run of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = lcs[i] as number[];
    const below = lcs[i + 1] as number[];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const steps: SequenceChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      const was = base.steps[i] as SequenceStep;
      const now = head.steps[j] as SequenceStep;
      const note = changeOf(was, now, notes);
      steps.push(note === undefined ? { ...now, status: 'same' } : { ...now, status: 'changed', note });
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && ((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number))) {
      steps.push({ ...(base.steps[i] as SequenceStep), status: 'removed' });
      i += 1;
    } else {
      steps.push({ ...(head.steps[j] as SequenceStep), status: 'added' });
      j += 1;
    }
  }
  const participants = new Map(head.participants.map((participant) => [participant.id, participant]));
  for (const participant of base.participants) if (!participants.has(participant.id)) participants.set(participant.id, participant);
  return { participants: [...participants.values()], steps };
};

/** Every step of a sequence with one status: a way in only one side has. */
export const onlyOn = (sequence: Sequence, status: 'added' | 'removed'): { participants: Participant[]; steps: SequenceChange[] } => ({
  participants: [...sequence.participants],
  steps: sequence.steps.map((step) => ({ ...step, status })),
});

/** How many steps of each status. */
export const countSteps = (steps: readonly { status: StepStatus }[]): Record<StepStatus, number> => {
  const counts: Record<StepStatus, number> = { same: 0, added: 0, removed: 0, changed: 0 };
  for (const step of steps) counts[step.status] += 1;
  return counts;
};

/** Whether a flow's steps say anything changed. */
export const flowChanged = (flow: Pick<FlowChange, 'counts'>): boolean =>
  flow.counts.added + flow.counts.removed + flow.counts.changed > 0;

/** What a walk on one side gave: the sequence and what the walk left out. */
export interface WalkedSide {
  sequence: Sequence;
  truncated?: string;
}

/**
 * One way in's flow change, from the sequences walked on each side that has it:
 * compared where both do, every step added or removed where one does.
 */
export const flowChangeOf = (
  entry: { id: string; label: string; service: string; reaches: number },
  sides: { base?: WalkedSide; head?: WalkedSide },
  options: DiffSequenceOptions = {},
): FlowChange | undefined => {
  const { base, head } = sides;
  const compared =
    base !== undefined && head !== undefined
      ? { side: 'both' as const, ...diffSequences(base.sequence, head.sequence, options) }
      : head !== undefined
        ? { side: 'head' as const, ...onlyOn(head.sequence, 'added') }
        : base !== undefined
          ? { side: 'base' as const, ...onlyOn(base.sequence, 'removed') }
          : undefined;
  if (compared === undefined) return undefined;
  const truncated = head?.truncated ?? base?.truncated;
  return {
    entry: entry.id,
    label: entry.label,
    service: entry.service,
    side: compared.side,
    reaches: entry.reaches,
    participants: compared.participants,
    steps: compared.steps,
    counts: countSteps(compared.steps),
    ...(truncated === undefined ? {} : { truncated }),
  };
};

/* ── Said as text ── */

/** The mark a step's line starts with. ASCII, so a `diff` block colours it. */
export const STATUS_MARK: Readonly<Record<StepStatus, string>> = { same: ' ', added: '+', removed: '-', changed: '~' };

/**
 * One step as a line of text: `+ orders → billing POST /invoices`, `~ … (body:
 * +channel (required))`, `orders stops here: call-dynamic-receiver`. What an
 * agent reads in place of the diagram (D3), and the step list under it.
 */
export const sayStep = (step: SequenceStep & { status?: StepStatus; note?: string }, participants: readonly Participant[]): string => {
  const name = (id: string): string => participants.find((participant) => participant.id === id)?.label ?? id;
  const mark = step.status === undefined ? '' : `${STATUS_MARK[step.status]} `;
  const doubt = step.confidence === 'heuristic' ? ' (best guess)' : '';
  const what = step.kind === 'stop' ? `${name(step.from)} stops here: ${step.label}` : `${name(step.from)} → ${name(step.to)} ${step.label}${doubt}`;
  return `${mark}${what}${step.note === undefined ? '' : ` (${step.note})`}`;
};

/** `2 steps added, 1 removed`, the counts a summary line says; empty when nothing changed. */
export const sayCounts = (counts: Record<StepStatus, number>): string =>
  (['added', 'removed', 'changed'] as const)
    .filter((status) => counts[status] > 0)
    .map((status, k) => (k === 0 ? `${counts[status]} ${counts[status] === 1 ? 'step' : 'steps'} ${status}` : `${counts[status]} ${status}`))
    .join(', ');

/** The services a flow crosses, in the order it first reaches each. */
export const servicesCrossed = (flow: Pick<FlowChange, 'participants' | 'steps'>): string[] => {
  const byId = new Map(flow.participants.map((participant) => [participant.id, participant]));
  const seen: string[] = [];
  for (const step of flow.steps) {
    for (const id of [step.from, step.to]) {
      const service = byId.get(id)?.service;
      if (service !== undefined && !seen.includes(service)) seen.push(service);
    }
  }
  return seen;
};
