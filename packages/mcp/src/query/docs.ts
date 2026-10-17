/**
 * What a doc block is about, read off the graph (P120): the node its id names,
 * the walk its view draws, the steps that walk reads as, and the fingerprint
 * of both - and, from `docs.json` beside the database, which blocks describe a
 * node, so an answer can tell an agent there is a page it must keep true.
 *
 * Shared by `flowatlas docs` (which renders and writes the blocks) and the
 * tools (which only say where they are and whether they still hold), so the
 * two never disagree about what a block says or whether it is stale. Views are
 * read-time renderings (I7): nothing here writes, and the graph stores nothing
 * about docs.
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { failuresOf, groupFailures, normalizePath, PROMPT_WALK, wasMissed, type GraphEdge, type GraphNode, type PromptSubject } from '@flowatlas/core';
import {
  DEFAULT_BLAST_DEPTH,
  diffSequences,
  DOCS_FILE,
  flowFingerprint,
  positionFreeId,
  readDocsIndex,
  sequenceOf,
  siteOfEdge,
  type DocBlock,
  type DocsEntry,
  type DocsIndex,
  type DocState,
  type DocView,
  type GraphDb,
  type Participant,
  type RecordedStep,
  type Sequence,
  type SequenceChange,
  type SequenceSite,
} from '@flowatlas/linker';
import { gatherPromptSubject } from '../prompt/gather.js';
import { projectDetail, projectEdge } from './detail.js';
import { isResolved, resolveEntryRef, type EntryRef } from './entry-ref.js';
import { buildFlowTree, DEFAULT_FLOW_DEPTH, defaultFlowDepth, REVERSE_EDGES } from './flow.js';
import { nearNames } from './names.js';
import type { FlowNode } from './types.js';

/** How much a block walks when it does not say: about what one screen of a page holds. */
export const DOC_WALK = { maxNodes: 60, detail: 1 } as const;

/** The detail a sequence is walked at: a channel participant reads its kind (`meta`), as `flow --format sequence` does. */
export const SEQUENCE_WALK_DETAIL = 2;

/** How many near names a block that names nothing is told about. */
const NEAR = 5;

/** The most ids an ambiguous block lists. */
const CANDIDATES = 8;

/** The parts of a block that decide what it is about and how it is walked. */
export type DocAsk = Pick<DocBlock, 'kind' | 'id' | 'options'> & Partial<Pick<DocBlock, 'view' | 'fingerprint' | 'recorded'>>;

export type DocTarget =
  | { found: 'node'; node: GraphNode }
  | { found: 'gone'; near: string[]; note?: string }
  | { found: 'ambiguous'; candidates: string[] };

const byId = (a: GraphNode, b: GraphNode): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A name as the nodes near it are labelled: a route said aloud with its
 * values as the graph writes them (`GET /shipments/:id` is labelled
 * `GET /shipments/:param`), a channel without its prefix.
 */
const saidAsLabel = (id: string): string => {
  const route = /^([A-Za-z]+)\s+(\/.*)$/.exec(id);
  if (route !== null) return `${(route[1] as string).toUpperCase()} ${normalizePath(route[2] as string)}`;
  return id.replace(/^channel:/, '');
};

/**
 * The node a block names: an id as it is, an entry said aloud (P94's
 * `resolveEntryRef`: a route, `bot:`, `invoke:`, a label), or a name that is
 * exactly one node's label. Not P94's last, fuzzy step: a block outlives the
 * code it was written against, and a route renamed from `POST /cart` to
 * `POST /carts` must read `gone` rather than quietly describe its nearest
 * neighbour. A channel may be named without its prefix. A block's `service`
 * narrows candidates to one service; a name that resolves to a node of
 * another service is not taken. Several candidates are named, never guessed;
 * nothing is `gone`, with the nearest names (I3).
 */
const strictly = (db: GraphDb, id: string): EntryRef => {
  const entry = resolveEntryRef(db, id);
  if (isResolved(entry) || entry.candidates.length > 0) return entry;
  const named = db.search(id, { limit: 200 }).filter((node) => node.label === id);
  return named.length === 1 ? { id: (named[0] as GraphNode).id, node: named[0] as GraphNode } : { candidates: named };
};

export const resolveDocTarget = (db: GraphDb, block: Pick<DocAsk, 'kind' | 'id' | 'options'>): DocTarget => {
  const id = block.id.trim();
  const service = block.options.service;
  const wantsChannel = block.kind === 'channel';
  const pool = (): GraphNode[] =>
    (wantsChannel ? db.nodesByType('channel') : block.kind === 'flow' ? db.nodesByType('entry') : db.search(id, { limit: 200 })).filter(
      (node) => service === undefined || node.repo === service,
    );
  const gone = (note?: string): DocTarget => ({
    found: 'gone',
    near: nearNames(pool(), saidAsLabel(id), NEAR).map((node) => node.id),
    ...(note === undefined ? {} : { note }),
  });

  if (wantsChannel) {
    const channel = db.node(id.startsWith('channel:') ? id : `channel:${id}`);
    if (channel !== undefined && channel.type === 'channel') return { found: 'node', node: channel };
  }
  const found = strictly(db, id);
  if (isResolved(found)) {
    if (wantsChannel && found.node.type !== 'channel') return gone(`${id} names ${found.node.id}, which is not a channel`);
    if (service !== undefined && found.node.repo !== service) return gone(`${id} names ${found.node.id}, in ${found.node.repo || 'no service'}, not ${service}`);
    return { found: 'node', node: found.node };
  }
  const candidates = found.candidates
    .filter((node) => (service === undefined || node.repo === service) && (!wantsChannel || node.type === 'channel'))
    .sort(byId);
  if (candidates.length === 1) return { found: 'node', node: candidates[0] as GraphNode };
  if (candidates.length > 1) return { found: 'ambiguous', candidates: candidates.slice(0, CANDIDATES).map((node) => node.id) };
  return gone();
};

/** Why a walk cannot see past a row: the reason of its first gap row by line (P116's `stopsIn`). */
export const stopsIn =
  (db: GraphDb) =>
  (row: Pick<FlowNode, 'node'>): string | undefined =>
    db
      .unresolvedFor(row.node.id)
      .filter((item) => wasMissed(item))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0))[0]?.reason;

/** The site of the graph edge behind each row, from the map a walk fills (`FlowOptions.edgesOf`). */
export const sitesFrom =
  (edges: ReadonlyMap<FlowNode, GraphEdge>) =>
  (row: FlowNode): SequenceSite | undefined => {
    const edge = edges.get(row);
    return edge === undefined ? undefined : siteOfEdge(edge);
  };

/** A step as the closing marker records it: no file, line or group, which a reformat moves. */
export const recordedOf = (step: Sequence['steps'][number]): RecordedStep => ({
  kind: step.kind,
  from: step.from,
  to: step.to,
  label: step.label,
  confidence: step.confidence,
  ...(step.params === undefined ? {} : { params: step.params }),
  ...(step.returns === undefined ? {} : { returns: step.returns }),
  ...(step.takes === undefined ? {} : { takes: step.takes }),
});

/** Everything a block's view is drawn from. */
export interface DocSubject {
  node: GraphNode;
  view: DocView;
  /** The walk the tree views draw: a channel's producers and consumers, a symbol's reach, an entry's flow. */
  tree: FlowNode;
  /** The ways in that reach a symbol, which a symbol block lists beside what it reaches. */
  reachedFrom: GraphNode[];
  sequence: Sequence;
  /** What the walk left out, said as the walk says it (I9). */
  truncated?: string;
  unresolvedOnPath: number;
  /** The prompt subject, for the `prompt` view: walked as `describe_for_prompt` walks. */
  prompt?: PromptSubject;
  fingerprint: string;
  /** The steps the fingerprint covered, as the closing marker records them. */
  steps: RecordedStep[];
}

const group = (id: string, label: string, children: FlowNode[]): FlowNode => ({
  node: { id, type: 'group', label: `${label} (${children.length})` },
  children,
});

/** Type ids a list of steps carries, in and out, each once. */
const typeIdsOf = (steps: readonly RecordedStep[]): string[] =>
  [...new Set(steps.flatMap((step) => [...(step.params ?? []), ...(step.returns === undefined ? [] : [step.returns]), ...(step.takes ?? [])]))].sort();

/**
 * What else a view shows that the walk and its steps do not say: the fields
 * of every shape a contract lists and the failures of its way in, a prompt's
 * gaps. Each without a position.
 */
const extraOf = (db: GraphDb, subject: Omit<DocSubject, 'fingerprint'>): unknown => {
  if (subject.view === 'contract') {
    return {
      shapes: typeIdsOf(subject.steps).map((id) => [id, db.type(id)?.structuralHash ?? null]),
      fails: groupFailures(failuresOf(subject.node)).map((item) => [item.status ?? null, item.exception]),
    };
  }
  if (subject.view === 'prompt' && subject.prompt !== undefined) {
    return {
      gaps: subject.prompt.gaps.map((gap) => [gap.reason, gap.service ?? null, gap.id === undefined ? null : gap.id.replace(/:\d+:\d+$/, '')]),
      fails: groupFailures(failuresOf(subject.node)).map((item) => [item.status ?? null, item.exception]),
    };
  }
  if (subject.reachedFrom.length > 0) return { reachedFrom: subject.reachedFrom.map((node) => node.id) };
  return undefined;
};

/** The ways in that reach a node, sorted, bounded by the walk's own budget. */
const waysInTo = (db: GraphDb, node: GraphNode, maxNodes: number): GraphNode[] =>
  node.type === 'entry'
    ? []
    : db
        .reverseReach(node.id, { edgeTypes: REVERSE_EDGES, maxDepth: PROMPT_WALK.reachDepth, maxNodes: PROMPT_WALK.reachNodes })
        .rows.filter((row) => row.type === 'entry' && row.id !== node.id)
        .map((row) => db.node(row.id))
        .filter((found): found is GraphNode => found !== undefined)
        .sort(byId)
        .slice(0, maxNodes);

/**
 * The walk a block's view draws, the steps it reads as, and their fingerprint.
 *
 * A `flow` block walks its entry as `flow` does (to `defaultFlowDepth`, or as
 * far as `diff` walks a sequence for the `sequence` view); a `channel` block
 * is its producers and the walk from the channel, as `flowatlas channel`
 * shows it; a `symbol` block is what the node reaches, with the ways in that
 * reach it. The `prompt` view walks as `describe_for_prompt` does. Every walk
 * is bounded by `max-nodes` (I9).
 */
export const docSubjectOf = (db: GraphDb, block: Pick<DocAsk, 'kind' | 'options' | 'view'>, node: GraphNode): DocSubject => {
  const view = block.view ?? 'steps';
  const prompt = view === 'prompt';
  const maxNodes = block.options.maxNodes ?? (prompt ? PROMPT_WALK.maxNodes : DOC_WALK.maxNodes);
  // A chain of steps (a workflow) is walked one hop further per step, as `flow` walks it.
  const steps0 = defaultFlowDepth(node) - DEFAULT_FLOW_DEPTH;
  const promptDepth = block.options.depth ?? PROMPT_WALK.depth;
  const depth = prompt
    ? promptDepth + steps0
    : (block.options.depth ?? (view === 'sequence' ? Math.max(defaultFlowDepth(node), DEFAULT_BLAST_DEPTH) : defaultFlowDepth(node)));
  const detail = view === 'sequence' ? SEQUENCE_WALK_DETAIL : (block.options.detail ?? DOC_WALK.detail);
  const edgesOf = new Map<FlowNode, GraphEdge>();
  const flow = buildFlowTree(db, node.id, { depth, maxNodes, detail, edgesOf });
  const read = sequenceOf(flow.root, { siteOf: sitesFrom(edgesOf), stopOf: stopsIn(db) });

  let tree = flow.root;
  let sequence = read;
  let reachedFrom: GraphNode[] = [];
  if (node.type === 'channel') {
    const producers = db
      .edgesTo(node.id, ['emits'])
      .flatMap((edge) => {
        const publisher = db.node(edge.from);
        return publisher === undefined ? [] : [{ publisher, edge }];
      })
      .sort((a, b) => byId(a.publisher, b.publisher));
    tree = {
      node: flow.root.node,
      children: [
        group(`${node.id}#producers`, 'producers', producers.map(({ publisher, edge }) => ({ node: projectDetail(publisher, detail), edge: projectEdge(edge, detail), children: [] }))),
        group(`${node.id}#consumers`, 'consumers', flow.root.children),
      ],
    };
    // The walk from a channel starts at the channel: its consumers take it
    // from there, and what publishes onto it comes first.
    const start = read.steps[0]?.to;
    const channel: Participant = { id: `channel:${node.label}`, label: node.label, kind: 'channel' };
    const services = new Map<string, Participant>();
    for (const { publisher } of producers) if (publisher.repo !== '') services.set(publisher.repo, { id: publisher.repo, label: publisher.repo, kind: 'service', service: publisher.repo });
    sequence = {
      participants: [...services.values(), channel, ...read.participants.filter((item) => item.id !== start && item.kind !== 'caller')],
      steps: [
        ...producers.map(({ publisher, edge }) => ({
          kind: 'emits' as const,
          from: publisher.repo === '' ? publisher.id : publisher.repo,
          to: channel.id,
          label: node.label,
          confidence: edge.confidence,
          ...(edge.params === undefined || edge.params.length === 0 ? {} : { params: [...edge.params] }),
        })),
        ...read.steps.slice(1).map((step) => ({ ...step, from: step.from === start ? channel.id : step.from, to: step.to === start ? channel.id : step.to })),
      ],
    };
  } else if (node.type !== 'entry') {
    reachedFrom = waysInTo(db, node, maxNodes);
  }

  const promptSubject = prompt ? gatherPromptSubject(db, node, undefined, { maxNodes, depth: promptDepth }) : undefined;
  const steps = sequence.steps.map(recordedOf);
  const subject = {
    node,
    view,
    tree,
    reachedFrom,
    sequence,
    ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }),
    unresolvedOnPath: flow.unresolvedOnPath,
    ...(promptSubject === undefined ? {} : { prompt: promptSubject }),
    steps,
  };
  // A symbol's ways in are part of what it says: one more that reaches it is a change.
  const recorded = [
    ...reachedFrom.map((entry): RecordedStep => ({ kind: 'enters', from: 'caller', to: entry.repo, label: entry.label, confidence: 'static' })),
    ...steps,
  ];
  return { ...subject, steps: recorded, fingerprint: flowFingerprint(flow.root, recorded, extraOf(db, subject)) };
};

/** What a check of one block found. */
export interface DocCheck {
  state: DocState;
  node?: GraphNode;
  /** The fingerprint the graph gives the block now; absent for a ref and a block that names nothing. */
  fingerprint?: string;
  /** Why it is `changed`: the steps added, removed and changed since it was written, as P116 reads them. */
  changes?: SequenceChange[];
  /** Said when a block is `changed` and its steps cannot show how: never written, or only inside a service. */
  why?: string;
  near?: string[];
  candidates?: string[];
  note?: string;
  subject?: DocSubject;
}

/** The steps recorded in a block, as a sequence `diffSequences` can read (participants by id). */
const asSequence = (steps: readonly RecordedStep[]): Sequence => ({
  participants: [],
  steps: steps.map((step) => ({ ...step })),
});

/**
 * One block checked against the graph: `ok` when the fingerprint its closing
 * marker holds is the one the graph gives it now; `changed` with the steps
 * added and removed (`diffSequences` over the recorded steps and the walk's)
 * when not, or when it was never written; `gone` or `ambiguous` when the id
 * no longer names one node. A ref is `ok` when its id names one.
 */
export const checkDocBlock = (db: GraphDb, block: DocAsk): DocCheck => {
  const target = resolveDocTarget(db, block);
  if (target.found === 'gone') return { state: 'gone', near: target.near, ...(target.note === undefined ? {} : { note: target.note }) };
  if (target.found === 'ambiguous') return { state: 'ambiguous', candidates: target.candidates };
  if (block.kind === 'ref') return { state: 'ok', node: target.node };
  const subject = docSubjectOf(db, block, target.node);
  const base = { node: target.node, fingerprint: subject.fingerprint, subject };
  if (block.fingerprint === subject.fingerprint) return { state: 'ok', ...base };
  if (block.fingerprint === undefined) return { state: 'changed', ...base, why: 'never written: run flowatlas docs --write' };
  if (block.recorded === undefined) return { state: 'changed', ...base, why: 'the fingerprint differs; the block records no steps to compare' };
  const diff = diffSequences(asSequence(block.recorded), asSequence(subject.steps));
  const changes = diff.steps.filter((step) => step.status !== 'same');
  return changes.length === 0
    ? { state: 'changed', ...base, why: 'the steps between services are the same; the walk inside a service changed' }
    : { state: 'changed', ...base, changes };
};

/* ── docs.json, beside the database ── */

/** Where `flowatlas docs` writes the index for a database. */
export const docsPathFor = (dbPath: string): string => join(dirname(dbPath), DOCS_FILE);

const held = new Map<string, { mtime: number; index: DocsIndex | undefined }>();

/** The index beside a database, or none; reread only when the file changes. */
export const loadDocsIndex = (dbPath: string): DocsIndex | undefined => {
  const path = docsPathFor(dbPath);
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
  const cached = held.get(path);
  if (cached !== undefined && cached.mtime === mtime) return cached.index;
  const { index } = readDocsIndex(path);
  held.set(path, { mtime, index });
  return index;
};

/** One block about a node, as an answer names it. */
export interface DocRef {
  file: string;
  line: number;
  kind: DocsEntry['kind'];
  state: DocState;
}

/** States worked out against one open database, so a second question about the same node walks nothing. */
const states = new WeakMap<GraphDb, { index: DocsIndex; byRow: Map<number, DocState> }>();

/** A row of the index checked against the graph as it is now, not as it was when the index was written. */
const stateNow = (db: GraphDb, index: DocsIndex, row: number): DocState => {
  let cache = states.get(db);
  if (cache === undefined || cache.index !== index) {
    cache = { index, byRow: new Map() };
    states.set(db, cache);
  }
  const known = cache.byRow.get(row);
  if (known !== undefined) return known;
  const entry = index.blocks[row] as DocsEntry;
  const state = checkDocBlock(db, {
    kind: entry.kind,
    id: entry.id,
    options: entry.options ?? {},
    ...(entry.view === undefined ? {} : { view: entry.view }),
    ...(entry.fingerprint === undefined ? {} : { fingerprint: entry.fingerprint }),
  }).state;
  cache.byRow.set(row, state);
  return state;
};

/**
 * The blocks of the index about a node, each checked against the graph now
 * (a build after the last `flowatlas docs` run is read as it stands). Empty
 * when there is no index.
 */
export const docsAbout = (db: GraphDb, dbPath: string, nodeId: string): DocRef[] => {
  const index = loadDocsIndex(dbPath);
  if (index === undefined) return [];
  return index.blocks.flatMap((entry, row) =>
    entry.node === nodeId ? [{ file: entry.file, line: entry.line, kind: entry.kind, state: stateNow(db, index, row) }] : [],
  );
};

/**
 * How many blocks of the index no longer say what the graph says, or none
 * when there is no index; with a service, the blocks about a node of it.
 */
export const staleDocsCount = (db: GraphDb, dbPath: string, service?: string): number | undefined => {
  const index = loadDocsIndex(dbPath);
  if (index === undefined) return undefined;
  return index.blocks.filter(
    (entry, row) => (service === undefined || (entry.node !== undefined && db.node(entry.node)?.repo === service)) && stateNow(db, index, row) !== 'ok',
  ).length;
};

/** Every block of the index that names a node, checked against the graph now: what the page lists per node. */
export const docsNow = (db: GraphDb, dbPath: string): Array<DocRef & { node: string }> => {
  const index = loadDocsIndex(dbPath);
  if (index === undefined) return [];
  return index.blocks.flatMap((entry, row) =>
    entry.node === undefined ? [] : [{ node: entry.node, file: entry.file, line: entry.line, kind: entry.kind, state: stateNow(db, index, row) }],
  );
};

/** `docs` on an answer, only when a block is about it. */
export const withDocs = (db: GraphDb, dbPath: string, nodeId: string): { docs?: DocRef[] } => {
  const docs = docsAbout(db, dbPath, nodeId);
  return docs.length === 0 ? {} : { docs };
};
