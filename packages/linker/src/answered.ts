/**
 * Whether an annotation has already answered a row, and the rows again with
 * the answered ones demoted (R36).
 *
 * Moved here from the doctor command (P80) so every surface that counts or
 * hides rows - the report, `doctor --unresolved`, `shapes --suggest`, the page
 * and the MCP server - demotes the same rows the same way. It asks only the
 * graph reader, never a source file.
 */
import type { GraphNode, Unresolved } from '@flowatlas/core';
import type { GraphDb } from './db/reader.js';

/**
 * Reasons that have been renamed, spelled both ways.
 *
 * A `reason` in this tool is not an internal string. It is user-visible
 * configuration surface: a project writes it in `doctor.ignoreReasons` to
 * silence a row, and a committed baseline can carry it. So renaming one is a
 * breaking change wearing the clothes of a rename, and this is what keeps it
 * from being one - the old spelling goes on working wherever somebody has
 * already written it, and nobody edits a configuration to keep an answer they
 * already chose.
 *
 * Forward only, deliberately. The question this answers is "somebody wrote the
 * old name, what did they mean", and it is asked of files a project committed
 * before the rename. Nothing asks the reverse, because no file older than the
 * rename can contain the new name.
 *
 * `openapi-document-age` is the first entry. It was the reason for the age of a
 * declared service's document, named when an OpenAPI document was the only kind
 * there was; there are two kinds now, so the kind goes in the message and the
 * reason names the question (R127).
 */
const RENAMED: ReadonlyMap<string, string> = new Map([
  ['openapi-document-age', 'document-age'],
]);

/** What a reason is called now, given whatever spelling somebody wrote. */
export const canonicalReason = (reason: string): string => RENAMED.get(reason) ?? reason;

/** As much of the graph as deciding "was this annotated?" needs to ask. */
export interface MarkerGraph {
  edgesFrom(id: string, types?: readonly string[]): ReadonlyArray<{ to: string; confidence: string }>;
  edgesTo(id: string, types?: readonly string[]): ReadonlyArray<{ from: string; confidence: string }>;
  node?(id: string): GraphNode | undefined;
}

/** The routes one request reaches, which is empty exactly when it was not joined. */
const routesOf = (id: string, graph: MarkerGraph): string[] =>
  graph.edgesFrom(id, ['hits']).map((edge) => edge.to);

/**
 * Every request written in one method, as the graph holds them.
 *
 * An annotation counts only where it says something no request in the method
 * already said. A method with one readable request, one `@flowatlas-calls`
 * naming the route that request already reaches, and one request nobody could
 * read used to come to `1 >= 1`, and the unreadable row was demoted on the
 * strength of an annotation that was about the other call (R43). A redundant
 * annotation is what `marker-callsservice-shadowed` exists to catch, and the
 * demotion now asks the same question that check asks: are the routes this
 * annotation names ones the source already reaches on its own?
 */
const requestsIn = (
  owner: string,
  graph: MarkerGraph,
): { asserted: number; unread: number } => {
  /** The routes each annotation's own request reaches. */
  const annotations: string[][] = [];
  /** Every route a request read from the source reaches, annotation or not. */
  const read = new Set<string>();
  let unread = 0;
  for (const edge of graph.edgesFrom(owner, ['calls'])) {
    const call = graph.node?.(edge.to);
    if (call === undefined || call.type !== 'ui_api_call') continue;
    const routes = routesOf(call.id, graph);
    // An annotation that named a route nothing serves has not answered
    // anything: the reader still has something to fix, and the marker checks
    // say what. Only one that reached a route counts.
    if (call.meta?.['via'] === 'marker') {
      if (routes.length > 0) annotations.push(routes);
      continue;
    }
    if (routes.length === 0) unread += 1;
    else for (const route of routes) read.add(route);
  }
  const asserted = annotations.filter(
    (routes) => !routes.every((route) => read.has(route)),
  ).length;
  return { asserted, unread };
};

/**
 * How a method's requests stand, for a row about one of them.
 *
 * Exported because the row's sentence needs the same two numbers the demotion
 * does: a method with two unreadable requests and one annotation keeps both
 * rows, and has to be told why (R39).
 */
/**
 * Whether a method's annotations can account for every request it could not read.
 *
 * One predicate, because two things ask it: the sentence a row carries and
 * whether the row counts as work. Written twice they drift, and the drift is a
 * row saying "nothing to do here" while still being counted among the things
 * to do — the exact fault R36 and R37 were raised about.
 */
export const coversEveryUnread = (found: { asserted: number; unread: number }): boolean =>
  found.asserted > 0 && found.asserted >= found.unread;

export const requestsAround = (
  callId: string,
  graph: MarkerGraph,
): { asserted: number; unread: number } | undefined => {
  const owner = graph.edgesTo(callId, ['calls'])[0]?.from;
  return owner === undefined ? undefined : requestsIn(owner, graph);
};

/** What the graph looks like once the annotation a row asks for has worked. */
type AnswerTest = (id: string, graph: MarkerGraph) => boolean;

const asserted = (edge: { confidence: string }): boolean => edge.confidence === 'marker';

/**
 * The annotation draws its edge from the annotated symbol itself.
 *
 * `@CallsService` on a method that makes a request: the call it names becomes
 * an `http_calls` edge out of that very node.
 */
const drawsFrom =
  (...types: string[]): AnswerTest =>
  (id, graph) =>
    graph.edgesFrom(id, types).some(asserted);

/**
 * The annotation draws a publish or a subscribe, which is two edges rather than
 * one.
 *
 * `@Emits` gives the method a producer to call and the producer a channel to
 * emit on; `@Consumes` gives the channel a consumer and the consumer a method
 * to hand to. Looking only for an `emits` edge out of the method finds nothing,
 * which is why a row an annotation had plainly answered kept asking for the
 * annotation (R37).
 */
/**
 * The annotation draws a request of its own, beside the one that was not read.
 *
 * `@flowatlas-calls` does not repair the call it is written above: it adds a
 * second `ui_api_call` that joins, and the unreadable one stays exactly as it
 * was. So the row's own node can never carry the edge, and looking there left
 * a reader who had done what the hint asked still being asked (R39).
 *
 * Answered only where the annotation can be about nothing else: a method whose
 * annotations — the ones that say something no readable request in the method
 * already says — are at least as many as its unreadable requests. One of each is
 * the ordinary shape. Two unreadable requests and one annotation is ambiguous, and silencing
 * both rows would hide a real gap behind an annotation that was never about
 * it — which is the fault this release exists to stop, not one to add.
 */
const annotatedBeside: AnswerTest = (id, graph) => {
  const found = requestsAround(id, graph);
  return found !== undefined && coversEveryUnread(found);
};

const publishesOrConsumes: AnswerTest = (id, graph) =>
  graph
    .edgesFrom(id, ['calls'])
    .filter(asserted)
    .some((edge) => graph.edgesFrom(edge.to, ['emits']).some(asserted)) ||
  graph
    .edgesTo(id, ['handles'])
    .filter(asserted)
    .some((edge) => graph.edgesTo(edge.from, ['consumes']).some(asserted));

/**
 * How to tell that the annotation a row asks for was written, and worked.
 *
 * A row is raised while one repository is being read, when nothing yet knows
 * whether an annotation somewhere answers it. Where one does, the edge is in
 * the joined graph with `confidence: marker` on it, and the row is a record of
 * what could not be read rather than something left to do (R36).
 *
 * Keyed by reason and valued by the shape to look for, so adding an annotation
 * means adding a line here rather than a branch anywhere. The shapes are named
 * because they are not all the same: some annotations draw one edge and some
 * draw a pair, and pretending otherwise is what R37 was raised about.
 */
export const MARKER_ANSWERS: Readonly<Record<string, AnswerTest>> = Object.freeze({
  // @CallsService, and its JSDoc twin @flowatlas-calls
  'dynamic-http-url': drawsFrom('http_calls'),
  'api-path-dynamic': annotatedBeside,
  'api-method-dynamic': annotatedBeside,
  // @Emits / @Consumes
  'channel-from-config': publishesOrConsumes,
  'channel-from-environment': publishesOrConsumes,
  'channel-dynamic': publishesOrConsumes,
  'channel-const-unresolved': publishesOrConsumes,
  // @FlowEntry
  'dynamic-bot-trigger': drawsFrom('triggers', 'handles'),
});

/**
 * Whether an annotation has already answered this row.
 *
 * Takes the graph reader rather than a database, so the question can be asked
 * of anything that can list edges — and so nothing here has to know what a
 * database is.
 */
export const answeredByMarker = (
  reason: string,
  nodeId: string | undefined,
  graph: MarkerGraph,
): boolean => {
  const key = canonicalReason(reason);
  const test = Object.hasOwn(MARKER_ANSWERS, key) ? MARKER_ANSWERS[key] : undefined;
  if (test === undefined || nodeId === undefined) return false;
  return test(nodeId, graph);
};

/** What is said instead of "annotate this", once an annotation has been read. */
export const ANSWERED_HINT =
  'An annotation already says where this goes, so the row is a record of what could not be read. Nothing to do here.';

/**
 * The body that makes the call a row names, when the row names a producer.
 *
 * A row about a publish or a start names the producer drawn for the call,
 * which is the node a walk passes (R177); the annotation that would answer it
 * is written on the body that calls it.
 */
export const callerOfProducer = (db: Pick<GraphDb, 'node' | 'edgesTo'>, id: string): string | undefined =>
  db.node(id)?.type === 'producer' ? db.edgesTo(id, ['calls'])[0]?.from : undefined;

/**
 * What a row needs to carry to be demoted: a reason and a level, where it is,
 * and what it is about - as the graph file writes it (`symbol`), or as the
 * database keeps it (`node`, with a file or line that may be null).
 */
export interface DemotableRow {
  reason: string;
  level?: Unresolved['level'] | null;
  hint?: string | null;
  service?: string | null;
  file?: string | null;
  line?: number | null;
  symbol?: string | null;
  node?: string | null;
}

/**
 * The rows again, with the ones an annotation has already answered demoted.
 *
 * A row saying "annotate this" that the joined graph can see is annotated is
 * not something to act on: acting on it means writing an annotation that is
 * already there. It was counted in the number at the top of the section, which
 * is the whole argument for reading the section, and it was a row the baseline
 * could never be cleared of, because nothing anybody writes can clear it (R36).
 *
 * Applied once, at the top, so the count, the grouping, the fold and the
 * baseline are all looking at the same rows. Idempotent: a row already at
 * `info` is left as it is. A row read back from the database is about its
 * `node`, which stands in for the symbol the graph file would have given it.
 */
export const withAnsweredDemoted = <T extends DemotableRow>(
  rows: readonly T[],
  db: Pick<GraphDb, 'node' | 'nodesByType' | 'allNodes' | 'edgesFrom' | 'edgesTo'>,
  /** What a row is about, when that is more than it carries: a row read back without its symbol. */
  symbolOf: (row: T) => string | undefined = (row) => row.symbol ?? row.node ?? undefined,
): T[] => {
  // Both kinds of outgoing request: one row's node is the call it names, and a
  // browser request was never indexed here at all, so no `api-path-dynamic`
  // row could find its node to be answered (R39).
  const callsAt = new Map<string, GraphNode>();
  for (const type of ['http_out', 'ui_api_call'] as const) {
    for (const call of db.nodesByType(type)) {
      callsAt.set(`${call.repo}|${call.file ?? ''}|${call.line ?? 0}`, call);
    }
  }
  /**
   * Methods by the name a row calls them, within the file they are declared in.
   *
   * A row read off one repository names its symbol as it is written rather
   * than by id: the method, then what about it could not be read. The line is
   * the line of the *call*, not of the method, so the join is the name and the
   * file — the same join `doctor` already makes to put a marker issue on a row.
   * A row about a publish names the producer instead, and its method is the one
   * that calls it (R177).
   */
  const methodsAt = new Map<string, GraphNode>();
  for (const node of db.allNodes()) {
    if (node.type !== 'method') continue;
    methodsAt.set(`${node.repo}|${node.file ?? ''}|${node.label}`, node);
  }
  const idFor = (row: T): string | undefined => {
    const symbol = symbolOf(row);
    if (symbol !== undefined && db.node(symbol) !== undefined) return callerOfProducer(db, symbol) ?? symbol;
    const here = callsAt.get(`${row.service ?? ''}|${row.file ?? ''}|${row.line ?? 0}`);
    if (here !== undefined) return here.id;
    if (symbol === undefined) return undefined;
    const named = symbol.split(' -> ')[0] ?? symbol;
    return methodsAt.get(`${row.service ?? ''}|${row.file ?? ''}|${named}`)?.id;
  };
  return rows.map((row) =>
    (row.level ?? 'action') === 'action' && answeredByMarker(row.reason, idFor(row), db)
      ? { ...row, level: 'info' as const, hint: ANSWERED_HINT }
      : row,
  );
};
