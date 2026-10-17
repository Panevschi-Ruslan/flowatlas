import {
  accessOf,
  failuresOf,
  joinIdOf,
  kindOfRow,
  loopOfEdge,
  parseGapId,
  PROMPT_WALK,
  runsBeside,
  runsOnFailure,
  siteOrderOf,
  STEPS_META,
  waysInOf,
  type Failure,
  type GraphEdge,
  type GraphNode,
  type PromptAccess,
  type PromptCheckPlace,
  type PromptFailure,
  type PromptGap,
  type PromptLog,
  type PromptMarks,
  type PromptStep,
  type PromptSubject,
} from '@flowatlas/core';
import { withAnsweredDemoted, type AnchoredUnresolvedRow, type GraphDb, type UnresolvedRow } from '@flowatlas/linker';
import { projectDetail } from '../query/detail.js';
import { buildFlowTree, REVERSE_EDGES } from '../query/flow.js';
import type { ObservedCounts } from '../query/observed.js';
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

const gapOf = (row: UnresolvedRow & { meta?: Record<string, unknown> }, id: string): PromptGap => {
  const loc = locOf(row);
  const waysIn = waysInOf(row);
  return {
    reason: row.reason,
    message: row.message,
    id,
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
