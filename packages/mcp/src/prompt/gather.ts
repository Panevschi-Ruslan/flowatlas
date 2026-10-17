import {
  accessOf,
  comparisonSays,
  failuresOf,
  joinIdOf,
  kindOfRow,
  loopOfEdge,
  parseGapId,
  PROMPT_LIMITS,
  PROMPT_WALK,
  runsBeside,
  runsOnFailure,
  siteOrderOf,
  STEPS_META,
  wasMissed,
  waysInOf,
  type Failure,
  type GraphEdge,
  type GraphNode,
  type PromptAccess,
  type PromptCheckPlace,
  type FailureComparison,
  type PromptFailure,
  type PromptFailuresSeen,
  type PromptGap,
  type PromptLog,
  type PromptMarks,
  type PromptMember,
  type PromptCount,
  type PromptCrossing,
  type PromptStep,
  type PromptSubject,
} from '@flowatlas/core';
import {
  methodsOf,
  ownerOf,
  withAnsweredDemoted,
  type AnchoredUnresolvedRow,
  type GraphDb,
  type UnresolvedRow,
} from '@flowatlas/linker';
import { projectDetail } from '../query/detail.js';
import { buildFlowTree, REVERSE_EDGES } from '../query/flow.js';
import { failuresSeen, type ObservedCounts } from '../query/observed.js';
import type { CompactNode, FlowNode } from '../query/types.js';

/**
 * The subject of a prompt, read from the database (P97).
 *
 * The page reads the same subject from its packed model (`subjectOf` in the
 * CLI's `steps.js`), and core's `renderPrompt` writes either: a fact one side
 * gathers differently from the other is a different text, which the parity
 * test on `fixtures/multi-repo` catches. So every rule here has its twin there.
 */

/** What stands in front of a way in, and the decorators that let a request past it (P76). */
const accessFor = (node: GraphNode): PromptAccess | undefined => {
  const access = node.type === 'entry' ? accessOf(node) : undefined;
  if (access === undefined) return undefined;
  return {
    guards: access.guards.map((guard) => ({
      name: guard.name,
      where: guard.where,
      via: guard.via,
      ...(guard.skippedBy === undefined ? {} : { skippedBy: guard.skippedBy }),
    })),
    ...(access.optOuts === undefined
      ? {}
      : {
          optOuts: access.optOuts.map((item) => ({
            decorator: item.decorator,
            where: item.where,
            public: item.public,
            skips: item.skips.join(', '),
          })),
        }),
  };
};

/** A stored failure with the fields the text reads, and no others. */
const failureOf = (item: Failure): PromptFailure => ({
  ...(item.status === undefined ? {} : { status: item.status }),
  exception: item.exception,
  at: item.at,
  ...(item.file === undefined ? {} : { file: item.file }),
  ...(item.line === undefined ? {} : { line: item.line }),
  source: item.source,
  ...(item.assumed === true ? { assumed: true as const } : {}),
  ...(item.declared === undefined ? {} : { declared: item.declared }),
  ...(item.via === undefined ? {} : { via: item.via }),
  ...(item.chosenFrom === undefined
    ? {}
    : {
        chosenFrom: item.chosenFrom.map((choice) => ({
          exception: choice.exception,
          ...(choice.status === undefined ? {} : { status: choice.status }),
          ...(choice.assumed === true ? { assumed: true as const } : {}),
        })),
      }),
  ...(item.family === undefined ? {} : { family: item.family }),
});

type LogLine = { level?: unknown; text?: unknown; at?: unknown };

/** The lines a node logs (P71), as the page packs them: a level, the line, the template. */
const logsFor = (node: GraphNode | undefined): PromptLog[] => {
  const list = node?.meta?.['logs'];
  if (!Array.isArray(list)) return [];
  return (list as LogLine[]).flatMap((item): PromptLog[] =>
    typeof item?.level !== 'string'
      ? []
      : [
          {
            level: item.level,
            ...(typeof item.at === 'number' && item.at > 0 ? { line: item.at } : {}),
            ...(typeof item.text === 'string' && item.text !== '' ? { text: item.text } : {}),
          },
        ],
  );
};

/** When a scheduled way in fires, and in which zone (P71). */
const scheduleFor = (node: GraphNode): PromptSubject['schedule'] => {
  const expression = node.meta?.['expression'];
  if (typeof expression !== 'string' || expression === '') return undefined;
  const zone = node.meta?.['timeZone'];
  return { expression, ...(typeof zone === 'string' && zone !== '' ? { zone } : {}) };
};

/** How many steps a chain a node starts holds (`STEPS_META`): a walk from it is that much deeper, as `get_flow`'s. */
const stepsIn = (node: GraphNode): number => {
  const steps = node.meta?.[STEPS_META];
  return typeof steps === 'number' && Number.isInteger(steps) && steps > 0 ? steps : 0;
};

/** A node as a line of the text: what it is and where it lives, nothing about how it was reached. */
const placeStep = (node: CompactNode, depth: number): PromptStep => ({
  depth,
  id: node.id,
  label: node.label,
  type: node.type,
  ...(node.kind === undefined ? {} : { kind: node.kind }),
  ...(node.service === undefined ? {} : { service: node.service }),
  ...(node.loc === undefined ? {} : { loc: node.loc }),
});

/** Whether a node has a likely N+1 row (P89) at the line a loop's edge sits at, the loop's own, or none. */
const nPlusOneAt = (db: GraphDb, edge: GraphEdge, loopLine: number): boolean =>
  db
    .unresolvedFor(edge.from)
    .some(
      (row) =>
        row.reason === 'query-in-loop' &&
        kindOfRow(row) === 'finding' &&
        [siteOrderOf(edge), loopLine, 0].includes(row.line ?? 0),
    );

/** What the edge into a step says about when and how often it runs, and how often it was seen. */
const marksFor = (db: GraphDb, edge: GraphEdge, underFailure: boolean, counts: ObservedCounts | undefined): PromptMarks => {
  const loop = loopOfEdge(edge);
  const seen = counts?.joins[joinIdOf(edge.from, edge.type, edge.to)]?.count ?? 0;
  return {
    ...(underFailure || runsOnFailure(edge) ? { failure: true as const } : {}),
    ...(runsBeside(edge) ? { together: true as const } : {}),
    ...(loop === undefined ? {} : { perItem: loop.kind }),
    ...(loop !== undefined && nPlusOneAt(db, edge, loop.line) ? { nPlusOne: true as const } : {}),
    ...(seen > 0 ? { seen } : {}),
  };
};

/**
 * The tree as lines in reading order, depth first, as a person reads a call
 * chain: each with how it was reached, what it carries, its marks and what it
 * logs. A repeat says where its own line is, and nothing else.
 */
const stepsOf = (
  db: GraphDb,
  root: FlowNode,
  edgesOf: ReadonlyMap<FlowNode, GraphEdge>,
  counts: ObservedCounts | undefined,
): PromptStep[] => {
  const steps: PromptStep[] = [];
  const visit = (item: FlowNode, depth: number, underFailure: boolean): void => {
    const edge = edgesOf.get(item);
    const node = item.node;
    if (node.ref === true) {
      steps.push({
        depth,
        id: node.id,
        label: node.label,
        type: node.type,
        repeat: true,
        ...(node.seenAt === undefined ? {} : { seenAt: node.seenAt }),
      });
      return;
    }
    // A node the graph does not hold says nothing beyond its id, as on the page, whose pack keeps no sites for it.
    const marks = edge === undefined || node.type === 'missing' ? {} : marksFor(db, edge, underFailure, counts);
    const logs = logsFor(db.node(node.id));
    steps.push({
      ...placeStep(node, depth),
      ...(item.edge === undefined
        ? {}
        : {
            via: {
              type: item.edge.type,
              confidence: item.edge.confidence,
              ...(item.edge.because === undefined ? {} : { because: item.edge.because }),
            },
            ...(item.edge.params === undefined ? {} : { params: item.edge.params }),
            ...(item.edge.returns === undefined ? {} : { returns: item.edge.returns }),
          }),
      ...(Object.keys(marks).length === 0 ? {} : { marks }),
      ...(logs.length === 0 ? {} : { logs }),
    });
    for (const child of item.children) visit(child, depth + 1, marks.failure === true);
  };
  for (const child of root.children) visit(child, 1, false);
  return steps;
};

const locOf = (row: Pick<UnresolvedRow, 'file' | 'line'>): string | undefined =>
  row.file === null ? undefined : row.line === null ? row.file : `${row.file}:${row.line}`;

const gapOf = (row: UnresolvedRow & { meta?: Record<string, unknown> }, id: string | undefined): PromptGap => {
  const loc = locOf(row);
  const waysIn = waysInOf(row);
  return {
    reason: row.reason,
    message: row.message,
    ...(id === undefined ? {} : { id }),
    ...(row.service === null ? {} : { service: row.service }),
    ...(loc === undefined ? {} : { loc }),
    ...(row.hint === null ? {} : { hint: row.hint }),
    ...(waysIn === undefined ? {} : { waysIn }),
  };
};

/** A node the graph points at and does not hold is a gap too, with a reason. */
const missingGap = (item: PromptStep): PromptGap => ({
  reason: 'node-missing',
  message: `the graph points at ${item.id} and holds no such node`,
  id: item.id,
});

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The ways in that reach a node, by id, a handful of them; none for a way in or a channel. */
const reachedFromOf = (db: GraphDb, node: GraphNode): PromptStep[] | undefined =>
  node.type === 'entry' || node.type === 'channel'
    ? undefined
    : db
        .reverseReach(node.id, { edgeTypes: REVERSE_EDGES, maxDepth: PROMPT_WALK.reachDepth, maxNodes: PROMPT_WALK.reachNodes })
        .rows.filter((row) => row.type === 'entry' && row.id !== node.id)
        .map((row) => db.node(row.id))
        .filter((found): found is GraphNode => found !== undefined)
        .sort(byId)
        .slice(0, PROMPT_WALK.reachedFrom)
        .map((found) => placeStep(projectDetail(found, 1), 1));

/** A comparison as the prompt subject holds it: without the entry id the subject already is (P106). */
export const promptFailuresSeen = ({ entry: _entry, ...rest }: FailureComparison): PromptFailuresSeen => rest;

/**
 * Everything the Markdown says about one node, read from the graph.
 *
 * The walk is the one `get_flow` answers with (P92), so the prompt and the
 * tool never disagree about the chain. A channel adds what publishes onto it;
 * anything that is not a way in adds the ways in that reach it; a way in adds
 * what stands in front of it, what it fails with and when it fires. `counts`
 * is what was seen at run time, when a trace was imported; `walk` the walk's
 * bounds, `PROMPT_WALK` unless a test asks for a shorter one.
 */
export const gatherPromptSubject = (
  db: GraphDb,
  node: GraphNode,
  counts?: ObservedCounts,
  walk: Pick<typeof PROMPT_WALK, 'maxNodes' | 'depth'> = PROMPT_WALK,
): PromptSubject => {
  const edgesOf = new Map<FlowNode, GraphEdge>();
  const flow = buildFlowTree(db, node.id, { maxNodes: walk.maxNodes, depth: walk.depth + stepsIn(node), detail: 1, edgesOf });
  const steps = stepsOf(db, flow.root, edgesOf, counts);

  // The rows as every surface counts them: demoted where an annotation answered them (P80).
  const rows = [node.id, ...new Set(steps.map((item) => item.id))].flatMap((id) =>
    db.unresolvedFor(id).map((row) => ({ ...row, node: id })),
  );
  const gaps: PromptGap[] = withAnsweredDemoted(rows, db).map((row) => gapOf(row, row.node));
  for (const item of steps) if (item.type === 'missing') gaps.push(missingGap(item));

  const producers =
    node.type === 'channel'
      ? db
          .edgesTo(node.id, ['emits'])
          .map((edge) => db.node(edge.from))
          .filter((found): found is GraphNode => found !== undefined)
          .sort(byId)
          .map((found) => placeStep(projectDetail(found, 1), 1))
      : undefined;
  const reachedFrom = reachedFromOf(db, node);

  const compact = projectDetail(node, 1);
  const fails = node.type === 'entry' ? failuresOf(node).map(failureOf) : [];
  const access = accessFor(node);
  const schedule = node.type === 'entry' ? scheduleFor(node) : undefined;
  const hits = node.type === 'entry' ? (counts?.entries[node.id]?.hits ?? 0) : 0;
  const compared = counts === undefined ? undefined : failuresSeen(counts, node);
  return {
    id: compact.id,
    label: compact.label,
    type: compact.type,
    ...(compact.kind === undefined ? {} : { kind: compact.kind }),
    ...(compact.service === undefined ? {} : { service: compact.service }),
    ...(compact.loc === undefined ? {} : { loc: compact.loc }),
    ...(schedule === undefined ? {} : { schedule }),
    ...(hits > 0 ? { hits } : {}),
    ...(access === undefined ? {} : { access }),
    ...(fails.length === 0 ? {} : { fails }),
    ...(comparisonSays(compared) ? { failuresSeen: promptFailuresSeen(compared) } : {}),
    steps,
    stepsCut: flow.left ?? 0,
    ...(flow.stoppedBy === undefined ? {} : { stepsCutBy: flow.stoppedBy[0] }),
    ...(producers === undefined ? {} : { producers }),
    ...(reachedFrom === undefined ? {} : { reachedFrom }),
    gaps,
  };
};

/** The rows a gap id names (`gap:<service>|<file>|<reason>`), by line. */
export const rowsOfGap = <T extends Pick<AnchoredUnresolvedRow, 'service' | 'file' | 'line' | 'reason' | 'message'>>(
  rows: readonly T[],
  gapId: string,
): T[] => {
  const gap = parseGapId(gapId);
  if (gap === undefined) return [];
  return rows
    .filter((row) => row.reason === gap.reason && (row.service ?? '') === (gap.service ?? '') && (row.file ?? '') === (gap.file ?? ''))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
};

/**
 * A check as the subject of a prompt: the gap id's places, each with the node
 * it is on, and the ways in that reach the first of those. `rows` are the
 * gap's rows as every surface counts them (`acceptedSplitOf`), by line.
 */
export const gatherCheckSubject = (db: GraphDb, gapId: string, rows: readonly AnchoredUnresolvedRow[]): PromptSubject | undefined => {
  const gap = parseGapId(gapId);
  const [first] = rows;
  if (gap === undefined || first === undefined) return undefined;
  const places = rows.map((row): PromptCheckPlace => {
    const loc = locOf(row);
    const on = row.node === null ? undefined : db.node(row.node);
    return {
      ...(loc === undefined ? {} : { loc }),
      message: row.message,
      ...(row.hint === null ? {} : { hint: row.hint }),
      ...(on === undefined ? {} : { on: placeStep(projectDetail(on, 1), 1) }),
    };
  });
  const firstOn = rows.map((row) => (row.node === null ? undefined : db.node(row.node))).find((node) => node !== undefined);
  const reachedFrom = firstOn === undefined ? undefined : reachedFromOf(db, firstOn);
  return {
    id: gapId,
    label: gap.reason,
    type: 'check',
    // Each level its rows are at, in the order of the rows: one demoted where an annotation answered it.
    kind: [...new Set(rows.map((row) => row.level))].join(', '),
    ...(gap.service === undefined || gap.service === null ? {} : { service: gap.service }),
    ...(gap.file === undefined || gap.file === null ? {} : { loc: gap.file }),
    check: { places },
    steps: [],
    stepsCut: 0,
    ...(reachedFrom === undefined ? {} : { reachedFrom }),
    gaps: [],
  };
};

/* ── Scoped subjects (P95): a class, a file, a service ── */

/** The ways in that reach any of these nodes, but none of them, by id, a handful: `reachedFromOf` for several at once. */
const reachedFromAny = (db: GraphDb, ids: readonly string[]): PromptStep[] => {
  if (ids.length === 0) return [];
  const own = new Set(ids);
  return db
    .reverseReach(ids, { edgeTypes: REVERSE_EDGES, maxDepth: PROMPT_WALK.reachDepth, maxNodes: PROMPT_WALK.reachNodes })
    .rows.filter((row) => row.type === 'entry' && !own.has(row.id))
    .map((row) => db.node(row.id))
    .filter((found): found is GraphNode => found !== undefined)
    .sort(byId)
    .slice(0, PROMPT_WALK.reachedFrom)
    .map((found) => placeStep(projectDetail(found, 1), 1));
};

/** The same gap once, whichever method's chain reached it first. */
const uniqueGaps = (gaps: readonly PromptGap[]): PromptGap[] => {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = [gap.id ?? '', gap.reason, gap.loc ?? '', gap.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** A node as the head of a scoped subject: what it is and where, no walk. */
const headOf = (node: GraphNode): Pick<PromptSubject, 'id' | 'label' | 'type' | 'kind' | 'service' | 'loc'> => {
  const compact = projectDetail(node, 1);
  return {
    id: compact.id,
    label: compact.label,
    type: compact.type,
    ...(compact.kind === undefined ? {} : { kind: compact.kind }),
    ...(compact.service === undefined ? {} : { service: compact.service }),
    ...(compact.loc === undefined ? {} : { loc: compact.loc }),
  };
};

/**
 * A class as one subject (P95): each method with the ways in that reach it
 * and its own chain, walked as `describe_for_prompt` walks a method, the
 * gaps of every chain once, and the ways in that reach any method.
 */
export const gatherClassSubject = (
  db: GraphDb,
  holder: GraphNode,
  counts?: ObservedCounts,
  walk: Pick<typeof PROMPT_WALK, 'maxNodes' | 'depth'> = PROMPT_WALK,
): PromptSubject => {
  const methods = methodsOf(db, holder.id)
    .map((id) => db.node(id))
    .filter((found): found is GraphNode => found !== undefined);
  const subjects = methods.map((method) => gatherPromptSubject(db, method, counts, walk));
  const members: PromptMember[] = subjects.map((subject) => ({
    id: subject.id,
    label: subject.label,
    type: subject.type,
    ...(subject.kind === undefined ? {} : { kind: subject.kind }),
    ...(subject.loc === undefined ? {} : { loc: subject.loc }),
    reachedFrom: subject.reachedFrom ?? [],
    steps: subject.steps,
    stepsCut: subject.stepsCut,
    ...(subject.stepsCutBy === undefined ? {} : { stepsCutBy: subject.stepsCutBy }),
  }));
  const own = withAnsweredDemoted(
    db.unresolvedFor(holder.id).map((row) => ({ ...row, node: holder.id })),
    db,
  ).map((row) => gapOf(row, row.node));
  return {
    ...headOf(holder),
    scope: 'class',
    steps: [],
    stepsCut: 0,
    reachedFrom: reachedFromAny(db, methods.map((method) => method.id)),
    members,
    gaps: uniqueGaps([...own, ...subjects.flatMap((subject) => subject.gaps)]),
  };
};

/** The class a node of a file belongs to: a method's owner, a class itself, a route's handler's, else the class of its first caller in the file. */
const groupOf = (db: GraphDb, node: GraphNode, inFile: ReadonlySet<string>): string | undefined => {
  const classOf = (id: string): string | undefined => {
    const found = db.node(id);
    if (found?.type === 'provider') return found.id;
    if (found?.type !== 'method') return undefined;
    const owner = ownerOf(id);
    return owner !== undefined && inFile.has(owner) ? owner : undefined;
  };
  if (node.type === 'provider' || node.type === 'method') return classOf(node.id);
  if (node.type === 'entry') {
    const handler = db.edgesFrom(node.id, ['handles']).map((edge) => edge.to).sort()[0];
    return handler === undefined ? undefined : classOf(handler);
  }
  const caller = db
    .edgesTo(node.id, REVERSE_EDGES)
    .map((edge) => edge.from)
    .filter((id) => inFile.has(id))
    .sort()[0];
  return caller === undefined ? undefined : classOf(caller);
};

/** The id of a file as a subject: `service#path`, the prefix every node id in it starts with. */
export const fileIdOf = (service: string, file: string): string => `${service}#${file}`;

/**
 * A file as one subject (P95): every node whose file it is, by the class it
 * belongs to and by line, the gaps recorded in the file, and the ways in that
 * reach any node in it.
 */
export const gatherFileSubject = (db: GraphDb, service: string, file: string): PromptSubject => {
  const nodes = db
    .allNodes()
    .filter((node) => node.repo === service && node.file === file)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || byId(a, b));
  const inFile = new Set(nodes.map((node) => node.id));
  const members: PromptMember[] = nodes.map((node) => {
    const head = headOf(node);
    const group = groupOf(db, node, inFile);
    return {
      id: head.id,
      label: head.label,
      type: head.type,
      ...(head.kind === undefined ? {} : { kind: head.kind }),
      ...(head.loc === undefined ? {} : { loc: head.loc }),
      ...(group === undefined ? {} : { group }),
      reachedFrom: [],
    };
  });
  // A row's symbol is a node's id only some of the time; the page keeps it only then.
  const rows = db
    .allUnresolved()
    .filter((row) => row.service === service && row.file === file)
    .map((row) => ({ ...row, node: row.node !== null && db.node(row.node) !== undefined ? row.node : '' }));
  const gaps = withAnsweredDemoted(rows, db).map((row) => gapOf(row, row.node === '' ? undefined : row.node));
  const id = fileIdOf(service, file);
  return {
    id,
    label: file,
    type: 'file',
    service,
    scope: 'file',
    steps: [],
    stepsCut: 0,
    reachedFrom: reachedFromAny(db, [...inFile]),
    members,
    gaps,
  };
};

/** How many of each kind are written out as ids on a service's lines. */
const OVERVIEW_FIRST = 3;

/** The requests between a service and each other one, by the other's name. */
const crossingCounts = (db: GraphDb, crossings: ReadonlyArray<{ service: string; from: string; to: string; type: string }>): PromptCrossing[] => {
  const by = new Map<string, Array<{ from: string; to: string; type: string }>>();
  for (const item of crossings) by.set(item.service, [...(by.get(item.service) ?? []), item]);
  const stepOf = (id: string): PromptStep => {
    const found = db.node(id);
    return found === undefined ? { depth: 1, id, label: id, type: 'missing' } : placeStep(projectDetail(found, 1), 1);
  };
  return [...by]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([service, list]) => ({
      service,
      count: list.length,
      first: list.slice(0, OVERVIEW_FIRST).map((hop) => ({ from: stepOf(hop.from), to: stepOf(hop.to), type: hop.type })),
    }));
};

/** What crosses between services: a request into an entry, a publish onto a channel another service consumes. */
export interface ServiceCrossing {
  from: string;
  to: string;
  type: string;
  /** The service at the far end. */
  service: string;
}

/**
 * A service's front as one subject (P95): its ways in by kind, its crossings
 * to and from the others (`crossingsBetween` for each pair, handed in), its
 * channels, its findings ranked by reach (handed in, as the `findings` tool
 * ranks them) and its most common gaps.
 */
export const gatherServiceSubject = (
  db: GraphDb,
  service: string,
  input: { out: readonly ServiceCrossing[]; into: readonly ServiceCrossing[]; findings: readonly PromptGap[] },
): PromptSubject => {
  const entries = db.nodesByType('entry').filter((node) => node.repo === service);
  const kinds = new Map<string, GraphNode[]>();
  for (const entry of entries) kinds.set(entry.kind ?? 'entry', [...(kinds.get(entry.kind ?? 'entry') ?? []), entry]);
  const waysIn: PromptCount[] = [...kinds]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([kind, list]) => ({
      kind,
      count: list.length,
      first: [...list].sort(byId).slice(0, OVERVIEW_FIRST).map((node) => placeStep(projectDetail(node, 1), 1)),
    }));

  const channelSteps = (ids: Iterable<string>): PromptStep[] =>
    [...new Set(ids)]
      .sort()
      .map((id) => db.node(id))
      .filter((found): found is GraphNode => found !== undefined)
      .map((found) => placeStep(projectDetail(found, 1), 1));
  const channels = db.nodesByType('channel');
  const publishes = channelSteps(
    channels.filter((channel) => db.edgesTo(channel.id, ['emits']).some((edge) => db.node(edge.from)?.repo === service)).map((channel) => channel.id),
  );
  const consumes = channelSteps(
    channels.filter((channel) => db.edgesFrom(channel.id, ['consumes']).some((edge) => db.node(edge.to)?.repo === service)).map((channel) => channel.id),
  );

  const findingKinds = new Map<string, PromptGap[]>();
  for (const gap of input.findings) findingKinds.set(gap.reason, [...(findingKinds.get(gap.reason) ?? []), gap]);

  const missed = db
    .allUnresolved()
    .filter((row) => row.service === service && wasMissed(row))
    .sort((a, b) => ((a.file ?? '') < (b.file ?? '') ? -1 : (a.file ?? '') > (b.file ?? '') ? 1 : (a.line ?? 0) - (b.line ?? 0)));
  const reasons = new Map<string, typeof missed>();
  for (const row of missed) reasons.set(row.reason, [...(reasons.get(row.reason) ?? []), row]);
  const gaps = [...reasons]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, PROMPT_LIMITS.maxGaps)
    .map(([reason, list]) => ({ reason, count: list.length, first: gapOf(list[0]!, list[0]!.node ?? undefined) }));

  return {
    id: service,
    label: service,
    type: 'service',
    scope: 'service',
    steps: [],
    stepsCut: 0,
    overview: {
      waysIn,
      crossingsOut: crossingCounts(db, input.out),
      crossingsIn: crossingCounts(db, input.into),
      publishes,
      consumes,
      findings: [...findingKinds].map(([kind, list]) => ({ kind, count: list.length, top: list.slice(0, OVERVIEW_FIRST) })),
      gaps,
    },
    gaps: [],
  };
};

/** The scopes `describe_for_prompt` writes (P95): one node, or the class, file or service it is in. */
export const PROMPT_SCOPES = ['node', 'method', 'class', 'file', 'service'] as const;
export type PromptScopeName = (typeof PROMPT_SCOPES)[number];

/** What the service scope needs from outside the prompt: the crossings and the ranked findings. */
export interface ScopeContext {
  counts?: ObservedCounts;
  crossings?: (from: string, to: string) => ReadonlyArray<{ from: string; to: string; type: string }>;
  findings?: (service: string) => readonly PromptGap[];
}

/** The scopes a node can be written at: always itself, its method, class, file and service where it has them. */
export const scopesFor = (db: GraphDb, node: GraphNode): PromptScopeName[] => [
  'node',
  ...(node.type === 'method' ? (['method'] as const) : []),
  ...(node.type === 'provider' || (node.type === 'method' && db.node(ownerOf(node.id) ?? '')?.type === 'provider') ? (['class'] as const) : []),
  ...(node.file === undefined || node.repo === '' ? [] : (['file'] as const)),
  ...(node.repo === '' ? [] : (['service'] as const)),
];

/**
 * A node at the scope asked for (P95), or undefined where the node has no
 * such scope (`scopesFor` says which it has). `node` and `method` are the
 * node itself; `class` the class it is or whose method it is; `file` and
 * `service` the ones it is in.
 */
export const gatherScopedSubject = (
  db: GraphDb,
  node: GraphNode,
  scope: PromptScopeName,
  context: ScopeContext = {},
): PromptSubject | undefined => {
  if (!scopesFor(db, node).includes(scope)) return undefined;
  if (scope === 'node' || scope === 'method') return gatherPromptSubject(db, node, context.counts);
  if (scope === 'class') {
    const holder = node.type === 'provider' ? node : db.node(ownerOf(node.id) ?? '');
    return holder === undefined ? undefined : gatherClassSubject(db, holder, context.counts);
  }
  if (scope === 'file') return gatherFileSubject(db, node.repo, node.file ?? '');
  return gatherServiceSubject(db, node.repo, serviceInputOf(db, node.repo, context));
};

/** The crossings out of and into a service, by the other service's name, and its findings. */
export const serviceInputOf = (
  db: GraphDb,
  service: string,
  context: ScopeContext,
): { out: ServiceCrossing[]; into: ServiceCrossing[]; findings: readonly PromptGap[] } => {
  const others = db
    .services()
    .map((each) => each.name)
    .filter((name) => name !== service)
    .sort();
  const between = context.crossings ?? (() => []);
  return {
    out: others.flatMap((other) => between(service, other).map((hop) => ({ ...hop, service: other }))),
    into: others.flatMap((other) => between(other, service).map((hop) => ({ ...hop, service: other }))),
    findings: context.findings?.(service) ?? [],
  };
};
