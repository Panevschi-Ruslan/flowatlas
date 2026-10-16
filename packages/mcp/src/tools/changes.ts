import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseGraphDiff, type BlastEntry, type DiffReport } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withNext } from '../query/next.js';
import { commonInput, serviceInput, respond, type ToolContext } from './common.js';

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

export interface ChangedEntry {
  id: string;
  type: string;
  kind: string;
  label: string;
  service: string;
  confidence: string;
  /** The changed node it reaches, nearest first. */
  reaches: string;
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
    changed: Array<{ id: string; service: string; label: string; fields: string[] }>;
  };
  types: { added: string[]; removed: string[]; changed: string[] };
  entries: ChangedEntry[];
  breaks: Array<{ message: string; edge: { from: string; to: string; type: string }; field: string }>;
  warnings: string[];
  truncated?: string;
}

/** The report cut to a service and a bound, with every list counted before it was cut. */
export const summariseChanges = (
  report: DiffReport,
  options: {
    service?: string;
    maxNodes: number;
    /** The service a node belongs to in the current graph, for ids the report names bare. */
    serviceOf?: (id: string) => string | undefined;
  },
): WhatChanged => {
  const { service, maxNodes } = options;
  const keep = (owner: string): boolean => service === undefined || owner === service;
  let cut = 0;
  const bounded = <T>(rows: readonly T[]): T[] => {
    if (rows.length > maxNodes) cut += rows.length - maxNodes;
    return rows.slice(0, maxNodes);
  };

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
      changed: bounded(changed).map(({ id, service: owner, label, fields }) => ({ id, service: owner, label, fields })),
    },
    types: {
      added: bounded(report.types.added),
      removed: bounded(report.types.removed),
      changed: bounded(report.types.changed.map((change) => change.id)),
    },
    entries: bounded([...entries.values()]),
    breaks: bounded(breaks).map((finding) => ({ message: finding.message, edge: finding.edge, field: finding.field })),
    warnings: report.warnings.map((warning) => warning.message),
  };
  if (cut > 0) result.truncated = `${cut} more rows, raise maxNodes or narrow with service`;
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
      description:
        'The last `flowatlas diff` read back: nodes, edges and types added, removed or changed, the ways in that reach them, and the contracts the branch broke. Run `flowatlas diff <base-ref>` to refresh it.',
      inputSchema: {
        service: serviceInput,
        ...commonInput,
      },
    },
    (input) => {
      const read = readDiff(ctx.handle.path);
      if ('error' in read) return respond({ error: read.error });
      const opened = ctx.handle.open();
      const changes = summariseChanges(read.report, {
        ...(input.service === undefined ? {} : { service: input.service }),
        ...('db' in opened ? { serviceOf: (id: string) => opened.db.node(id)?.repo } : {}),
        maxNodes: input.maxNodes,
      });
      return respond(withNext(changes, nextOf(changes)));
    },
  );
};
