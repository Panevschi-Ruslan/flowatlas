import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DetailLevel } from '@flowatlas/core';
import {
  findingKindOf,
  flowChanged,
  isCheckDocument,
  NEVER_PRODUCED,
  parseCheckReport,
  parseGraphDiff,
  sayStep,
  sectionsMissing,
  type BlastEntry,
  type FlowChange,
  type DiffReport,
  type DiffSide,
  type GapRef,
  type GraphDb,
  type LostJoin,
} from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { REVERSE_EDGES } from '../query/flow.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { loadObservedCounts, nodeSeen, type ObservedCounts } from '../query/observed.js';
import { truncationMessage } from '../query/types.js';
import { bound, callOf, commonInput, pagedNext, pageInput, READ_ONLY, respond, serviceInput, type ToolContext } from './common.js';

/**
 * What a branch changed, as `flowatlas diff` last worked it out (P72).
 *
 * The comparison itself builds the graph at two revisions in detached
 * checkouts, which takes minutes and writes to disk; a tool call is the wrong
 * place for that. `flowatlas diff <base>` leaves `diff.json` beside the
 * database, and this reads it: the same document, cut to what a session asks
 * next — which nodes moved, which ways in reach them, which contracts broke.
 */
export const DIFF_FILE = 'diff.json';

/**
 * A way in a change reaches. At `detail` 0 its id, type and the changed node
 * it reaches; from 1 what it is and whose (P93).
 */
export interface ChangedEntry {
  id: string;
  type: string;
  kind?: string;
  label?: string;
  service?: string;
  confidence?: string;
  /** The changed node it reaches, nearest first. */
  reaches: string;
  /** What its flow does now that it did not before, when it changed (P116). */
  flow?: FlowSaid;
}

/**
 * A way in's flow, compared step by step (P116): how many steps were added,
 * removed and changed, and from detail 1 the changed steps as text
 * (`+ orders → billing POST /invoices`), never a diagram, at most
 * `MAX_STEP_LINES` of them.
 */
export interface FlowSaid {
  /** `both`, or `head`/`base` for a way in only that side has. */
  side: FlowChange['side'];
  added: number;
  removed: number;
  changed: number;
  steps?: string[];
}

/** How many changed steps a flow says as text; the rest are counted in a last line. */
export const MAX_STEP_LINES = 12;

/** A changed flow's steps said for an agent: the ones that changed, in order. */
export const flowSaid = (flow: FlowChange): FlowSaid => {
  const lines = flow.steps.filter((step) => step.status !== 'same').map((step) => sayStep(step, flow.participants));
  const steps = lines.length > MAX_STEP_LINES ? [...lines.slice(0, MAX_STEP_LINES), `… ${lines.length - MAX_STEP_LINES} more changed steps; get_flow on the entry`] : lines;
  return { side: flow.side, added: flow.counts.added, removed: flow.counts.removed, changed: flow.counts.changed, steps };
};

/** A changed node: its id at 0, whose and its label from 1, the fields that changed at 2. */
export interface ChangedNode {
  id: string;
  service?: string;
  label?: string;
  fields?: string[];
}

/** One side of the comparison said in words (P96): `head: null` read as "no head". */
export interface SideSaid {
  /** The ref asked for, or null where the working tree was read. */
  ref: string | null;
  /** `working tree`, or the ref and the commit each service was read at. */
  label: string;
}

export interface WhatChanged {
  base: SideSaid;
  head: SideSaid;
  generatedAt: string;
  /**
   * How long each list is before `maxNodes` cut it, of the service asked
   * about when one was (P96): set beside the list, each count shows the cut.
   */
  counts: {
    nodes: { added: number; removed: number; changed: number; moved: number };
    edges: { added: number; removed: number; changed: number };
    types: { added: number; removed: number; changed: number };
    entries: number;
    contracts: { new: number; breaks: number; fixed: number };
    /** Gap ids added and removed, gaps and findings (format 2). */
    gaps: { added: number; removed: number };
    /** Calls and channel ends that stopped joining (format 2). */
    lostJoins: number;
    /** Ways in whose flow changed (format 3). */
    flows: number;
  };
  nodes: {
    added: string[];
    removed: string[];
    changed: ChangedNode[];
  };
  types: { added: string[]; removed: string[]; changed: string[] };
  /** The ways in a change reaches; left out when `verdict` ranks them under `retest`. */
  entries?: ChangedEntry[];
  breaks: Array<{ message: string; edge: { from: string; to: string; type: string }; field: string }>;
  warnings: string[];
  /** Rows left past this page, over every list, and where the next page starts. */
  truncated?: string;
  /** The `offset` of the next page, which pages every list at once. */
  nextOffset?: number;
  /** Set when the service asked about is in no part of the diff. */
  note?: string;
  verdict?: VerdictWord;
  because?: string[];
  newGaps?: NewGap[];
  vanishedTargets?: VanishedTarget[];
  retest?: RetestEntry[];
  newFindings?: NewFinding[];
}

/* ── The verdict (P96) ── */

/** What a branch is, said as a rule with its reasons (D1). */
export const VERDICTS = ['safe', 'unsafe', 'unknown'] as const;
export type VerdictWord = (typeof VERDICTS)[number];

/** A gap id the head has and the base does not, with the call that shows it. */
export interface NewGap {
  id: string;
  reason: string;
  service: string;
  file: string;
  line?: number;
  /** The method the gap is in, when the graph draws it. */
  node?: string;
  sites: number;
  /** Set when the gap sits on a path from a changed node to a way in: the change cannot be seen past. */
  onChangedPath?: true;
  next: string;
}

/** A caller whose target the branch took away: the base side's join, and what the head side says instead. */
export interface VanishedTarget {
  caller: string;
  target: string;
  now: string;
}

/** A way in to retest: how many changed nodes it reaches, and how often real traffic came through it. */
export interface RetestEntry extends ChangedEntry {
  changed: number;
  observed?: number;
}

/** Something the branch says about the code that it did not before (P95's kinds); never unsafe on its own. */
export interface NewFinding {
  kind: string;
  id: string;
  service: string;
  loc?: string;
  /** The gap id of a row finding; a contract warning names its receiving side under `to`. */
  gapId?: string;
  to?: string;
  message?: string;
}

export interface Verdict {
  verdict: VerdictWord;
  because: string[];
  newGaps: NewGap[];
  vanishedTargets: VanishedTarget[];
  retest: RetestEntry[];
  newFindings: NewFinding[];
}

/** What the verdict reads beside the report: the head graph, for paths, and run-time counts, for ranking. */
export interface VerdictOptions {
  service?: string;
  /** The current graph. Without it a gap is on a changed path only when it is in a changed node or its file. */
  db?: GraphDb;
  observed?: ObservedCounts;
}

/** Warnings that mean a service was read from its working tree on both sides, or not read at all. */
const UNREAD_WARNINGS: ReadonlySet<string> = new Set(['ref-not-found', 'not-a-git-repo', 'base-extract-failed']);

/** The `diff.json` sections the verdict is decided by; a document without one of them is `unknown` (I11). */
const VERDICT_SECTIONS: ReadonlySet<string> = new Set(['unresolved', 'joins', 'rules']);

/** How far back from a change the path to a way in is walked: as far as the blast radius goes, bounded (I9). */
const PATH_WALK = { maxDepth: 25, maxNodes: 5000 } as const;

/**
 * The service an id names, for a row the report and the graph both lost:
 * `orders#src/…`, `entry:orders:…`, `http_out:orders#…`, `type:orders#Name`.
 * A channel is nobody's.
 */
export const serviceInId = (id: string): string | undefined => {
  if (id.startsWith('channel:')) return undefined;
  const entry = /^entry:([^:]+):/.exec(id);
  if (entry !== null) return entry[1];
  const hash = id.indexOf('#');
  if (hash <= 0) return undefined;
  const head = id.slice(0, hash);
  const colon = head.lastIndexOf(':');
  return colon < 0 ? head : head.slice(colon + 1);
};

const short = (sha: string): string => sha.slice(0, 8);

/** `working tree`, or `main (billing 392089da, orders 08ad86ef; gateway from the working tree)`. */
export const sideLabel = (side: DiffSide): string => {
  if (side.ref === null) return 'working tree';
  const names = Object.keys(side.services).sort();
  const read = names.flatMap((name) => {
    const sha = side.services[name]?.sha;
    return sha === null || sha === undefined ? [] : [`${name} ${short(sha)}`];
  });
  const tree = names.filter((name) => (side.services[name]?.sha ?? null) === null);
  const parts = [read.join(', '), tree.length === 0 ? '' : `${tree.join(', ')} from the working tree`].filter((part) => part !== '');
  return parts.length === 0 ? side.ref : `${side.ref} (${parts.join('; ')})`;
};

const said = (side: DiffSide): SideSaid => ({ ref: side.ref, label: sideLabel(side) });

/** Every service the diff names anywhere: read on a side, owning a change, or reached by one. */
const servicesIn = (report: DiffReport): Set<string> =>
  new Set([
    ...Object.keys(report.base.services),
    ...Object.keys(report.head.services),
    ...report.nodes.changed.map((change) => change.service),
    ...report.impact.flatMap((row) => [row.service, ...row.services]),
    ...report.unresolved.added.map((ref) => ref.service),
    ...report.unresolved.removed.map((ref) => ref.service),
  ]);

/** The report's rows of one service, before any cut: the lists every count and the verdict read. */
interface Scoped {
  changed: DiffReport['nodes']['changed'];
  added: string[];
  removed: string[];
  moved: string[];
  edges: DiffReport['edges'];
  types: { added: string[]; removed: string[]; changed: string[] };
  entries: Map<string, RetestEntry>;
  fresh: DiffReport['contracts']['new'];
  breaks: DiffReport['contracts']['new'];
  /** New violations of a rule at error along edges that are not guesses (P114). */
  ruleBreaks: DiffReport['rules']['new'];
  fixed: number;
  gapsAdded: GapRef[];
  gapsRemoved: GapRef[];
  lost: LostJoin[];
  /** The changed flows of the ways in kept (P116). */
  flows: FlowChange[];
  known: boolean;
}

const scopeOf = (report: DiffReport, service: string | undefined, serviceOf?: (id: string) => string | undefined): Scoped => {
  const keep = (owner: string | null | undefined): boolean => service === undefined || owner === service;
  // A removed node is gone from the current graph; the impact row walked on the
  // base side still says whose it was, and the id says it of the rest.
  const owners = new Map(report.impact.map((row) => [row.node, row.service]));
  const ownerOf = (id: string): string | undefined => owners.get(id) ?? serviceOf?.(id) ?? serviceInId(id);
  const byService = (ids: readonly string[]): string[] => (service === undefined ? [...ids] : ids.filter((id) => ownerOf(id) === service));
  const byEdge = <T extends { from: string }>(edges: readonly T[]): T[] => (service === undefined ? [...edges] : edges.filter((edge) => ownerOf(edge.from) === service));
  const byType = (ids: readonly string[]): string[] => (service === undefined ? [...ids] : ids.filter((id) => serviceInId(id) === service));

  const flows = new Map(report.flows.filter(flowChanged).map((flow) => [flow.entry, flow]));
  const entries = new Map<string, RetestEntry>();
  for (const row of report.impact) {
    if (service !== undefined && !row.services.includes(service)) continue;
    for (const entry of row.entries as BlastEntry[]) {
      if (!keep(entry.service)) continue;
      const held = entries.get(entry.id);
      if (held !== undefined) {
        held.changed += 1;
        continue;
      }
      const flow = flows.get(entry.id);
      entries.set(entry.id, {
        id: entry.id,
        type: entry.type,
        kind: entry.kind,
        label: entry.label,
        service: entry.service,
        confidence: entry.confidence,
        reaches: row.node,
        ...(flow === undefined ? {} : { flow: flowSaid(flow) }),
        changed: 1,
      });
    }
  }
  const touches = (finding: { sender: { service: string }; receiver: { service: string } }): boolean =>
    service === undefined || finding.sender.service === service || finding.receiver.service === service;
  const fresh = report.contracts.new.filter(touches);
  return {
    changed: report.nodes.changed.filter((change) => keep(change.service)),
    added: byService(report.nodes.added),
    removed: byService(report.nodes.removed),
    moved: byService(report.nodes.moved),
    edges: { added: byEdge(report.edges.added), removed: byEdge(report.edges.removed), changed: byEdge(report.edges.changed) },
    types: {
      added: byType(report.types.added),
      removed: byType(report.types.removed),
      changed: byType(report.types.changed.map((change) => change.id)),
    },
    entries,
    fresh,
    breaks: fresh.filter((finding) => finding.severity === 'error'),
    // A guessed violation is listed by the CLI and never decides a verdict (P114 D4).
    ruleBreaks: report.rules.new.filter(
      (item) => item.severity === 'error' && !item.heuristic && (service === undefined || item.fromService === service || item.toService === service),
    ),
    fixed: report.contracts.fixed.filter(touches).length,
    gapsAdded: report.unresolved.added.filter((ref) => keep(ref.service)),
    gapsRemoved: report.unresolved.removed.filter((ref) => keep(ref.service)),
    lost: report.joins.lost.filter((join) => keep(join.service) || (service !== undefined && join.targetService === service)),
    flows: [...flows.values()].filter((flow) => keep(flow.service) || flow.participants.some((participant) => participant.service === service)),
    known: service === undefined || servicesIn(report).has(service),
  };
};

/**
 * The nodes on a path from a changed or added node back to a way in: the
 * nodes themselves and everything that reaches them, walked once on the head
 * graph. A gap in one of them is a change the reader can no longer see past.
 */
const changedPaths = (report: DiffReport, db: GraphDb | undefined): Set<string> => {
  const starts = [...report.nodes.changed.map((change) => change.id), ...report.nodes.added];
  const on = new Set(starts);
  if (db === undefined || starts.length === 0) return on;
  for (const row of db.traverse({ from: starts, direction: 'in', edgeTypes: REVERSE_EDGES, ...PATH_WALK }).rows) on.add(row.id);
  return on;
};

/** Whether a gap sits on a changed path: its method is on one, or it names none and its file holds a change. */
const onPath = (ref: GapRef, paths: ReadonlySet<string>, changedFiles: ReadonlySet<string>): boolean =>
  ref.node !== undefined ? paths.has(ref.node) : changedFiles.has(`${ref.service}#${ref.file}`);

/** `orders#src/a.ts` of every changed or added symbol id, for gaps that name no method. */
const changedFilesOf = (report: DiffReport): Set<string> =>
  new Set(
    [...report.nodes.changed.map((change) => change.id), ...report.nodes.added].flatMap((id) => {
      const match = /^(?:[a-z_]+:)?([^:#]+#[^:]+):/.exec(id);
      return match === null ? [] : [match[1]!];
    }),
  );

const quoted = (id: string): string => `\`${id}\``;

const plural = (count: number, one: string, many: string = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const firstOf = <T>(rows: readonly T[], say: (row: T) => string): string => (rows.length === 0 ? '' : `: ${say(rows[0]!)}${rows.length > 1 ? ', …' : ''}`);

/**
 * Safe, unsafe or unknown, each for a reason written down (D1).
 *
 * Unsafe: a new contract error; a new violation of an architecture rule at
 * `error` along edges that are not guesses (P114); a call whose target went, or a channel end
 * left with nothing at the other end; a removed way in another service still
 * calls. Unknown: a service read from its working tree on both sides (or not
 * read), a new gap on a path from a change to a way in, or a `diff.json` too
 * old to hold gaps, lost joins and rule violations. Safe otherwise. Every reason is a sentence
 * under `because`, unsafe ones first, so a reviewer disagrees with a reason
 * rather than with a score. Findings are listed and never decide it.
 */
export const verdictOf = (report: DiffReport, options: VerdictOptions = {}): Verdict => {
  const { service, db } = options;
  const scoped = scopeOf(report, service, db === undefined ? undefined : (id) => db.node(id)?.repo);
  const unsafe: string[] = [];
  const unknown: string[] = [];

  if (scoped.breaks.length > 0) {
    unsafe.push(`${plural(scoped.breaks.length, 'new contract error')}${firstOf(scoped.breaks, (finding) => finding.message)}`);
  }
  if (scoped.ruleBreaks.length > 0) {
    unsafe.push(
      `${plural(scoped.ruleBreaks.length, 'new violation')} of an architecture rule${firstOf(scoped.ruleBreaks, (item) => `${quoted(item.rule)}: ${item.message}`)}`,
    );
  }
  const targets = scoped.lost.filter((join) => join.kind === 'target-gone');
  if (targets.length > 0) {
    unsafe.push(
      `${plural(targets.length, 'call')} lost ${targets.length === 1 ? 'its' : 'their'} target${firstOf(targets, (join) => `${quoted(join.caller)} joined ${quoted(join.target)} and is now ${join.now}`)}`,
    );
  }
  const ends = scoped.lost.filter((join) => join.kind !== 'target-gone');
  if (ends.length > 0) {
    unsafe.push(
      `${plural(ends.length, 'channel end')} lost the other end${firstOf(ends, (join) => join.now === NEVER_PRODUCED ? `${quoted(join.target)} has no producer for the new ${quoted(join.caller)}` : `${quoted(join.target)} has ${join.kind === 'no-producer' ? 'no producer' : 'no consumer'} left for ${quoted(join.caller)}`)}`,
    );
  }
  const removedEntries = [
    ...new Set(
      targets
        .filter((join) => join.targetRemoved && join.target.startsWith('entry:') && join.targetService !== null && join.targetService !== join.service)
        .map((join) => `${quoted(join.target)} (called from ${join.service})`),
    ),
  ];
  if (removedEntries.length > 0) {
    unsafe.push(`${plural(removedEntries.length, 'removed way in is', 'removed ways in are')} still called from another service: ${removedEntries.join(', ')}`);
  }

  // Only the sections the verdict reads: a document with no flows says nothing
  // less about whether a branch is safe.
  const missing = sectionsMissing(report).filter((section) => VERDICT_SECTIONS.has(section));
  if (missing.length > 0) {
    unknown.push(`diff.json is format ${report.diffFormatVersion}, which holds no ${missing.join(' or ')}; rerun flowatlas diff for new gaps, lost joins and rule violations`);
  }
  const unread = [
    ...new Set(
      report.warnings
        .filter((warning) => UNREAD_WARNINGS.has(warning.reason) && warning.service !== null && (service === undefined || warning.service === service))
        .map((warning) => warning.service as string),
    ),
  ].sort();
  if (unread.length > 0) {
    unknown.push(`${unread.join(', ')} ${unread.length === 1 ? 'was' : 'were'} not read at the base ref, so ${unread.length === 1 ? 'it is' : 'they are'} reported unchanged without being compared`);
  }

  const paths = changedPaths(report, db);
  const files = changedFilesOf(report);
  const gapRefs = scoped.gapsAdded.filter((ref) => ref.kind === 'gap');
  const newGaps: NewGap[] = gapRefs
    .map((ref): NewGap => {
      const path = onPath(ref, paths, files);
      return {
        id: ref.id,
        reason: ref.reason,
        service: ref.service,
        file: ref.file,
        ...(ref.line === undefined ? {} : { line: ref.line }),
        ...(ref.node === undefined ? {} : { node: ref.node }),
        sites: ref.sites,
        ...(path ? { onChangedPath: true as const } : {}),
        next:
          ref.node === undefined
            ? callOf('search', { query: ref.file, kinds: ['gaps'] })
            : callOf('get_source', { symbol: ref.node }),
      };
    })
    // The ones a change cannot be seen past first: they are the verdict's.
    .sort((a, b) => Number(b.onChangedPath === true) - Number(a.onChangedPath === true));
  const hidden = newGaps.filter((gap) => gap.onChangedPath === true);
  if (hidden.length > 0) {
    unknown.push(
      `${plural(hidden.length, 'new gap')} on a path from a change to a way in, which the reading cannot see past${firstOf(hidden, (gap) => `${gap.reason} in ${quoted(gap.node ?? `${gap.service} ${gap.file}`)}`)}`,
    );
  }
  if (!scoped.known) unknown.push(`no such service in the diff: ${quoted(service ?? '')}`);

  const newFindings: NewFinding[] = [
    ...scoped.gapsAdded
      .filter((ref) => ref.kind === 'finding')
      .map((ref): NewFinding => ({
        kind: findingKindOf(ref.reason),
        id: ref.node ?? ref.id,
        service: ref.service,
        loc: ref.line === undefined ? ref.file : `${ref.file}:${ref.line}`,
        gapId: ref.id,
      })),
    ...scoped.fresh
      .filter((finding) => finding.severity === 'warning')
      .map((finding): NewFinding => ({
        kind: 'contract-break',
        id: finding.edge.from,
        service: finding.sender.service,
        to: finding.edge.to,
        message: finding.message,
      })),
  ];

  const counts = options.observed;
  const retest = [...scoped.entries.values()]
    .map((entry) => {
      const seen = counts === undefined ? undefined : nodeSeen(counts, entry.id);
      return seen === undefined ? entry : { ...entry, observed: seen };
    })
    .sort((a, b) => b.changed - a.changed || (b.observed ?? 0) - (a.observed ?? 0));

  const verdict: VerdictWord = unsafe.length > 0 ? 'unsafe' : unknown.length > 0 ? 'unknown' : 'safe';
  const because = [...unsafe, ...unknown];
  if (verdict === 'safe') {
    because.push('no new contract error, no new violation of an architecture rule, no call or channel lost what it joined, and no new gap on a path from a change to a way in');
    const off = newGaps.length - hidden.length;
    if (off > 0) because.push(`${plural(off, 'new gap')} off every changed path, listed under newGaps`);
  }
  if (newFindings.length > 0) {
    because.push(`${plural(newFindings.length, 'new finding')}, listed under newFindings, which do not decide the verdict`);
  }
  return {
    verdict,
    because,
    newGaps,
    vanishedTargets: scoped.lost.map((join) => ({ caller: join.caller, target: join.target, now: join.now })),
    retest,
    newFindings,
  };
};

/**
 * The report cut to a service, a level and a page, with every list counted
 * before it was cut.
 *
 * One `offset` pages every list at once (P93): the rows a list has past the
 * page are counted together, and the next page is the same call from
 * `nextOffset`. `detail` is 2 when not given, the whole row. Under `service`
 * every count is that service's (P96), and with `verdict` the answer adds the
 * verdict and its lists, paged with the rest, the ways in ranked under
 * `retest` in place of `entries`.
 */
export const summariseChanges = (
  report: DiffReport,
  options: {
    service?: string;
    maxNodes: number;
    offset?: number;
    detail?: DetailLevel;
    /** The service a node belongs to in the current graph, for ids the report names bare. */
    serviceOf?: (id: string) => string | undefined;
    /** Ask for the verdict, read with these (P96). */
    verdict?: Omit<VerdictOptions, 'service'>;
  },
): WhatChanged => {
  const { service, maxNodes } = options;
  const offset = options.offset ?? 0;
  const detail = options.detail ?? 2;
  let cut = 0;
  const bounded = <T>(rows: readonly T[]): T[] => {
    const page = rows.slice(offset, offset + maxNodes);
    cut += Math.max(rows.length - offset - page.length, 0);
    return page;
  };
  const changedNode = ({ id, service: owner, label, fields }: { id: string; service: string; label: string; fields: string[] }): ChangedNode =>
    detail <= 0 ? { id } : detail === 1 ? { id, service: owner, label } : { id, service: owner, label, fields };
  // At detail 0 a flow is its counts; its steps as text from 1.
  const flowAt = (flow: FlowSaid | undefined): { flow?: FlowSaid } => {
    if (flow === undefined) return {};
    const { steps: _steps, ...counts } = flow;
    return { flow: detail <= 0 ? counts : flow };
  };
  const changedEntry = (entry: RetestEntry): ChangedEntry => {
    const { changed: _changed, observed: _observed, ...row } = entry;
    return detail <= 0 ? { id: row.id, type: row.type, reaches: row.reaches, ...flowAt(row.flow) } : row;
  };
  const retestEntry = (entry: RetestEntry): RetestEntry =>
    detail <= 0
      ? {
          id: entry.id,
          type: entry.type,
          reaches: entry.reaches,
          ...flowAt(entry.flow),
          changed: entry.changed,
          ...(entry.observed === undefined ? {} : { observed: entry.observed }),
        }
      : entry;

  const scoped = scopeOf(report, service, options.serviceOf);
  const result: WhatChanged = {
    base: said(report.base),
    head: said(report.head),
    generatedAt: report.generatedAt,
    counts: {
      nodes: { added: scoped.added.length, removed: scoped.removed.length, changed: scoped.changed.length, moved: scoped.moved.length },
      edges: { added: scoped.edges.added.length, removed: scoped.edges.removed.length, changed: scoped.edges.changed.length },
      types: { added: scoped.types.added.length, removed: scoped.types.removed.length, changed: scoped.types.changed.length },
      entries: scoped.entries.size,
      contracts: { new: scoped.fresh.length, breaks: scoped.breaks.length, fixed: scoped.fixed },
      gaps: { added: scoped.gapsAdded.length, removed: scoped.gapsRemoved.length },
      lostJoins: scoped.lost.length,
      flows: scoped.flows.length,
    },
    nodes: {
      added: bounded(scoped.added),
      removed: bounded(scoped.removed),
      changed: bounded(scoped.changed).map(changedNode),
    },
    types: {
      added: bounded(scoped.types.added),
      removed: bounded(scoped.types.removed),
      changed: bounded(scoped.types.changed),
    },
    ...(options.verdict === undefined ? { entries: bounded([...scoped.entries.values()]).map(changedEntry) } : {}),
    breaks: bounded(scoped.breaks).map((finding) => ({ message: finding.message, edge: finding.edge, field: finding.field })),
    warnings: report.warnings.map((warning) => warning.message),
  };
  if (!scoped.known) result.note = 'no such service in the diff';
  if (options.verdict !== undefined) {
    const verdict = verdictOf(report, { ...options.verdict, ...(service === undefined ? {} : { service }) });
    result.verdict = verdict.verdict;
    result.because = verdict.because;
    result.newGaps = bounded(verdict.newGaps);
    result.vanishedTargets = bounded(verdict.vanishedTargets);
    result.retest = bounded(verdict.retest).map(retestEntry);
    result.newFindings = bounded(verdict.newFindings);
  }
  if (cut > 0) {
    result.truncated = truncationMessage(cut, true, { nextOffset: offset + maxNodes });
    result.nextOffset = offset + maxNodes;
  }
  return result;
};

/** The calls that take what a change names: trace the first way in, weigh the first changed node. */
const nextOf = (changes: WhatChanged): string[] => {
  const hints: string[] = [];
  const entry = changes.entries?.[0];
  if (entry !== undefined && entry.type === 'entry') hints.push(callOf('get_flow', { entry: entry.id }));
  const node = changes.nodes.changed[0]?.id ?? changes.nodes.added[0];
  if (node !== undefined) hints.push(callOf('impact', { symbol: node }), callOf('get_source', { symbol: node }));
  const type = changes.types.changed[0];
  if (type !== undefined) hints.push(callOf('get_type', { type }));
  return hints.slice(0, MAX_NEXT);
};

/**
 * The calls a verdict hands on (P96): trace the way in to retest first, check
 * the first break, read the method the first new gap is in (one on a changed
 * path first), then the caller that lost its target.
 */
const verdictNextOf = (changes: WhatChanged): string[] => {
  const hints: string[] = [];
  const top = changes.retest?.find((entry) => entry.type === 'entry');
  if (top !== undefined) hints.push(callOf('get_flow', { entry: top.id }));
  const brk = changes.breaks[0];
  if (brk !== undefined) hints.push(callOf('check_contract', { from: brk.edge.from, to: brk.edge.to }));
  const gap = changes.newGaps?.[0];
  if (gap !== undefined) hints.push(gap.next);
  const lost = changes.vanishedTargets?.[0];
  if (lost !== undefined) hints.push(callOf('who_calls', { symbol: lost.caller }));
  return hints.length > 0 ? hints.slice(0, MAX_NEXT) : nextOf(changes);
};

/** A document `what_changed` may be pointed at: `diff.json`, or a `check.<env>.json` (P117), beside the database. */
const READABLE = /^(?:diff\.json|check\.[A-Za-z0-9][A-Za-z0-9._-]*\.json)$/;

/** What a check document adds to the answer: which environment, and its verdict (P117). */
export interface CheckSaid {
  environment: string;
  verdict: string;
  /** The reasons it is not deployable, or why it could not decide. */
  because: string[];
}

/**
 * The last `flowatlas diff`, or (`file`) a check document, read into one
 * `DiffReport`: a check's `diff` is its deployed side as base and the
 * candidate as head, so every reader of a diff reads it too.
 */
export const readDiff = (dbPath: string, file: string = DIFF_FILE): { report: DiffReport; check?: CheckSaid } | { error: string } => {
  if (!READABLE.test(file)) {
    return { error: `${JSON.stringify(file)} is not a document what_changed reads: diff.json, or check.<env>.json beside the database` };
  }
  const path = join(dirname(dbPath), file);
  if (!existsSync(path)) {
    return {
      error: file === DIFF_FILE ? `no ${DIFF_FILE} beside the database; run flowatlas diff <base-ref> first` : `no ${file} beside the database; run flowatlas check --env <name> first`,
    };
  }
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isCheckDocument(value)) return { report: parseGraphDiff(value) };
    const check = parseCheckReport(value);
    const because =
      check.verdict.verdict === 'undecided'
        ? check.verdict.undecided.map((refusal) => `${refusal.message}. ${refusal.hint}`)
        : check.verdict.reasons.map((reason) => reason.message);
    const said: CheckSaid = { environment: check.environment, verdict: check.verdict.verdict, because };
    if (check.diff === null) return { error: `${file} holds no comparison: ${check.environment} is ${check.verdict.verdict}; ${because.join('; ')}` };
    return { report: check.diff, check: said };
  } catch (cause) {
    return {
      error: `cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}; run ${file === DIFF_FILE ? 'flowatlas diff' : 'flowatlas check'} again`,
    };
  }
};

/** Every `check.<env>.json` beside the database and its verdict, for `start_here` (P117). */
export const checksBeside = (dbPath: string): Record<string, string> => {
  const found: Record<string, string> = {};
  let names: string[];
  try {
    names = readdirSync(dirname(dbPath));
  } catch {
    return found;
  }
  for (const name of names.sort()) {
    if (name === DIFF_FILE || !READABLE.test(name)) continue;
    try {
      const check = parseCheckReport(JSON.parse(readFileSync(join(dirname(dbPath), name), 'utf8')));
      found[check.environment] = check.verdict.verdict;
    } catch {
      // A document this build cannot read says nothing about a deploy.
    }
  }
  return found;
};

/**
 * Whether the last diff can still be read as this database's (P96): there is
 * one, and no build replaced the database after it was written. A build after
 * the diff means the head it compared is no longer the graph being asked.
 */
export const diffState = (dbPath: string): { state: 'missing' | 'older' | 'fresh'; path: string } => {
  const path = join(dirname(dbPath), DIFF_FILE);
  if (!existsSync(path)) return { state: 'missing', path };
  try {
    return { state: existsSync(dbPath) && statSync(path).mtimeMs < statSync(dbPath).mtimeMs ? 'older' : 'fresh', path };
  } catch {
    return { state: 'missing', path };
  }
};

export const registerChanges = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'what_changed',
    {
      title: 'What a branch changed',
      description: 'The last `flowatlas diff` (or `check`): what changed, the ways in it reaches, contracts broken; `verdict`: safe, and why.',
      inputSchema: {
        service: serviceInput,
        file: z.string().optional(),
        verdict: z.boolean().optional(),
        ...commonInput,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) => {
      const read = readDiff(ctx.handle.path, input.file);
      if ('error' in read) return respond({ error: read.error });
      const { detail, maxNodes, note } = bound(input);
      const opened = ctx.handle.open();
      const db = 'db' in opened ? opened.db : undefined;
      const observed: ObservedCounts | undefined = input.verdict === true ? loadObservedCounts(ctx.handle.path) : undefined;
      const changes = summariseChanges(read.report, {
        ...(input.service === undefined ? {} : { service: input.service }),
        ...(db === undefined ? {} : { serviceOf: (id: string) => db.node(id)?.repo }),
        maxNodes,
        offset: input.offset,
        detail,
        ...(input.verdict === true
          ? { verdict: { ...(db === undefined ? {} : { db }), ...(observed === undefined ? {} : { observed }) } }
          : {}),
      });
      const args = { service: input.service, file: input.file, verdict: input.verdict, detail: input.detail, maxNodes };
      const notes = [changes.note, note].filter((text): text is string => text !== undefined);
      return respond(
        withNext(
          { ...(read.check === undefined ? {} : { check: read.check }), ...changes, ...(notes.length === 0 ? {} : { note: notes.join('; ') }) },
          pagedNext(
            { tool: 'what_changed', args, nextOffset: changes.nextOffset },
            input.verdict === true ? verdictNextOf(changes) : nextOf(changes),
          ),
        ),
      );
    },
  );
};
