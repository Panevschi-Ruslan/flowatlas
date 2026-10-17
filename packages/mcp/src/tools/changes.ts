import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DetailLevel } from '@flowatlas/core';
import { parseGraphDiff, type BlastEntry, type DiffReport } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { truncationMessage } from '../query/types.js';
import { withNext } from '../query/next.js';
import { bound, commonInput, pagedNext, pageInput, READ_ONLY, respond, serviceInput, type ToolContext } from './common.js';

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
}

/** A changed node: its id at 0, whose and its label from 1, the fields that changed at 2. */
export interface ChangedNode {
  id: string;
  service?: string;
  label?: string;
  fields?: string[];
}

export interface WhatChanged {
  base: string | null;
  head: string | null;
  generatedAt: string;
  counts: {
    nodes: { added: number; removed: number; changed: number; moved: number };
    edges: { added: number; removed: number; changed: number };
    types: { added: number; removed: number; changed: number };
    entries: number;
    contracts: { new: number; breaks: number; fixed: number };
  };
  nodes: {
    added: string[];
    removed: string[];
    changed: ChangedNode[];
  };
  types: { added: string[]; removed: string[]; changed: string[] };
  entries: ChangedEntry[];
  breaks: Array<{ message: string; edge: { from: string; to: string; type: string }; field: string }>;
  warnings: string[];
  /** Rows left past this page, over every list, and where the next page starts. */
  truncated?: string;
  /** The `offset` of the next page, which pages every list at once. */
  nextOffset?: number;
}

/**
 * The report cut to a service, a level and a page, with every list counted
 * before it was cut.
 *
 * One `offset` pages every list at once (P93): the rows a list has past the
 * page are counted together, and the next page is the same call from
 * `nextOffset`. `detail` is 2 when not given, the whole row.
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
  },
): WhatChanged => {
  const { service, maxNodes } = options;
  const offset = options.offset ?? 0;
  const detail = options.detail ?? 2;
  const keep = (owner: string): boolean => service === undefined || owner === service;
  let cut = 0;
  const bounded = <T>(rows: readonly T[]): T[] => {
    const page = rows.slice(offset, offset + maxNodes);
    cut += Math.max(rows.length - offset - page.length, 0);
    return page;
  };
  const changedNode = ({ id, service: owner, label, fields }: { id: string; service: string; label: string; fields: string[] }): ChangedNode =>
    detail <= 0 ? { id } : detail === 1 ? { id, service: owner, label } : { id, service: owner, label, fields };
  const changedEntry = (entry: ChangedEntry): ChangedEntry =>
    detail <= 0 ? { id: entry.id, type: entry.type, reaches: entry.reaches } : entry;

  const changed = report.nodes.changed.filter((change) => keep(change.service));
  const impact = report.impact.filter((row) => service === undefined || row.services.includes(service));
  const entries = new Map<string, ChangedEntry>();
  for (const row of impact) {
    for (const entry of row.entries as BlastEntry[]) {
      if (!keep(entry.service) || entries.has(entry.id)) continue;
      entries.set(entry.id, {
        id: entry.id,
        type: entry.type,
        kind: entry.kind,
        label: entry.label,
        service: entry.service,
        confidence: entry.confidence,
        reaches: row.node,
      });
    }
  }
  const touches = (finding: { sender: { service: string }; receiver: { service: string } }): boolean =>
    service === undefined || finding.sender.service === service || finding.receiver.service === service;
  const fresh = report.contracts.new.filter(touches);
  const breaks = fresh.filter((finding) => finding.severity === 'error');
  // A removed node is gone from the current graph; the impact row walked on the
  // base side still says whose it was.
  const owners = new Map(report.impact.map((row) => [row.node, row.service]));
  const byService = (ids: readonly string[]): string[] =>
    service === undefined
      ? [...ids]
      : ids.filter((id) => (owners.get(id) ?? options.serviceOf?.(id)) === service);

  const result: WhatChanged = {
    base: report.base.ref,
    head: report.head.ref,
    generatedAt: report.generatedAt,
    counts: {
      nodes: {
        added: report.nodes.added.length,
        removed: report.nodes.removed.length,
        changed: report.nodes.changed.length,
        moved: report.nodes.moved.length,
      },
      edges: {
        added: report.edges.added.length,
        removed: report.edges.removed.length,
        changed: report.edges.changed.length,
      },
      types: {
        added: report.types.added.length,
        removed: report.types.removed.length,
        changed: report.types.changed.length,
      },
      entries: entries.size,
      contracts: { new: fresh.length, breaks: breaks.length, fixed: report.contracts.fixed.filter(touches).length },
    },
    nodes: {
      added: bounded(byService(report.nodes.added)),
      removed: bounded(byService(report.nodes.removed)),
      changed: bounded(changed).map(changedNode),
    },
    types: {
      added: bounded(report.types.added),
      removed: bounded(report.types.removed),
      changed: bounded(report.types.changed.map((change) => change.id)),
    },
    entries: bounded([...entries.values()]).map(changedEntry),
    breaks: bounded(breaks).map((finding) => ({ message: finding.message, edge: finding.edge, field: finding.field })),
    warnings: report.warnings.map((warning) => warning.message),
  };
  if (cut > 0) {
    result.truncated = truncationMessage(cut, true, offset + maxNodes);
    result.nextOffset = offset + maxNodes;
  }
  return result;
};

/** The calls that take what a change names: trace the first way in, weigh the first changed node. */
const nextOf = (changes: WhatChanged): string[] => {
  const hints: string[] = [];
  const entry = changes.entries[0];
  if (entry !== undefined && entry.type === 'entry') hints.push(`get_flow({entry: ${JSON.stringify(entry.id)}})`);
  const node = changes.nodes.changed[0]?.id ?? changes.nodes.added[0];
  if (node !== undefined) hints.push(`impact({symbol: ${JSON.stringify(node)}})`, `get_source({symbol: ${JSON.stringify(node)}})`);
  const type = changes.types.changed[0];
  if (type !== undefined) hints.push(`get_type({type: ${JSON.stringify(type)}})`);
  return hints.slice(0, 4);
};

export const readDiff = (dbPath: string): { report: DiffReport } | { error: string } => {
  const path = join(dirname(dbPath), DIFF_FILE);
  if (!existsSync(path)) {
    return { error: `no ${DIFF_FILE} beside the database; run flowatlas diff <base-ref> first` };
  }
  try {
    return { report: parseGraphDiff(JSON.parse(readFileSync(path, 'utf8'))) as DiffReport };
  } catch (cause) {
    return {
      error: `cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}; run flowatlas diff again`,
    };
  }
};

export const registerChanges = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'what_changed',
    {
      title: 'What a branch changed',
      description: 'The last `flowatlas diff`: what changed, the ways in it reaches, contracts broken.',
      inputSchema: {
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) => {
      const read = readDiff(ctx.handle.path);
      if ('error' in read) return respond({ error: read.error });
      const { detail, maxNodes, note } = bound(input);
      const opened = ctx.handle.open();
      const changes = summariseChanges(read.report, {
        ...(input.service === undefined ? {} : { service: input.service }),
        ...('db' in opened ? { serviceOf: (id: string) => opened.db.node(id)?.repo } : {}),
        maxNodes,
        offset: input.offset,
        detail,
      });
      const args = { service: input.service, detail: input.detail, maxNodes };
      return respond(
        withNext(
          { ...changes, ...(note === undefined ? {} : { note }) },
          pagedNext({ tool: 'what_changed', args, nextOffset: changes.nextOffset }, nextOf(changes)),
        ),
      );
    },
  );
};
