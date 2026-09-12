import type { Command } from 'commander';
import { moreRows, renderTable } from '../format/table.js';
import { loadGraph, type AnalysisGraph } from '../analysis/graph.js';
import { maxRows, openProjectDb, print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { tarjanScc, type Cycle } from '../analysis/scc.js';
import { ANALYTICS_FORMAT_VERSION, type CyclesResult } from '../analysis/shapes.js';

/**
 * Edges a cycle is allowed to run through.
 *
 * `imports` is left out because a module import cycle is a different and much
 * noisier fault, and `injects` because `forwardRef` is a Nest idiom: both would
 * bury the cross-service loops this command exists to find.
 */
export const CYCLE_EDGES = ['calls', 'handles', 'http_calls', 'hits', 'triggers'] as const;

export interface CyclesOptions extends ReadOptions {
  crossService?: boolean;
  includeDi?: boolean;
  minLength?: string | number;
}

export interface CyclesRun {
  result: CyclesResult;
  lines: string[];
}

/**
 * `orders:OrdersService.create → (channel:order.created) → billing:…`, one line.
 *
 * Every hop carries its service, since which boundary the loop crosses is the
 * whole reason a cycle in a polyrepo is worth printing.
 */
const asPath = (cycle: Cycle, graph: AnalysisGraph): string => {
  const label = (id: string): string => {
    const node = graph.nodes.get(id);
    if (node === undefined) return id;
    return node.service === '' ? node.label : `${node.service}:${node.label}`;
  };
  const hops = cycle.edges.map(
    (edge) => `${edge.via === undefined ? '' : `(${edge.via}) `}${label(edge.to)}`,
  );
  const start = label(cycle.edges[0]?.from ?? cycle.id);
  return [start, ...hops].join(' → ') + (cycle.truncatedEdges === undefined ? '' : ' → …');
};

export const runCycles = (options: CyclesOptions): CyclesRun => {
  const { db, close } = openProjectDb(options);
  try {
    const max = maxRows(options);
    const minLength = options.minLength === undefined ? 2 : Number(options.minLength);
    const edgeTypes = [...CYCLE_EDGES, ...(options.includeDi === true ? ['injects'] : [])];
    const graph = loadGraph(db, { edgeTypes, collapseChannels: true });

    const all = tarjanScc(graph, { minLength }).filter(
      (cycle) => options.crossService !== true || cycle.crossService,
    );
    const shown = all.slice(0, max);

    const warnings: Array<{ reason: string; hint?: string }> = [];
    const report = db.report();
    // Zero cycles is the answer either way, but zero cycles because nothing was
    // stitched is a different fact and would otherwise read as a clean bill.
    if (shown.length === 0 && report !== undefined && report.httpOut.linked === 0) {
      warnings.push({
        reason: 'nothing-stitched',
        hint: 'no outgoing call was joined to a route; see flowatlas doctor',
      });
    }

    const result: CyclesResult = {
      analyticsFormatVersion: ANALYTICS_FORMAT_VERSION,
      cycles: shown,
      ...(all.length > shown.length ? { truncated: all.length - shown.length } : {}),
      ...(warnings.length === 0 ? {} : { warnings }),
    };

    const lines =
      shown.length === 0
        ? ['0 cycles']
        : renderTable(shown, [
            { header: 'services', value: (cycle) => cycle.services.join(',') },
            { header: 'len', value: (cycle) => String(cycle.length), align: 'right' },
            { header: 'confidence', value: (cycle) => cycle.confidence },
            { header: 'cycle', value: (cycle) => asPath(cycle, graph) },
          ]);
    if (result.truncated !== undefined) lines.push(moreRows(result.truncated));
    for (const warning of warnings) lines.push(`warning: ${warning.reason} — ${warning.hint ?? ''}`);

    return { result, lines };
  } finally {
    close();
  }
};

export const registerCycles = (program: Command): void => {
  program
    .command('cycles')
    .description('call cycles across the project, cross-service ones first')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--cross-service', 'only cycles that leave a service and come back')
    .option('--include-di', 'follow injects as well, so forwardRef cycles appear')
    .option('--min-length <n>', 'smallest cycle reported (1 includes self-recursion)', '2')
    .option('--max <n>', 'most rows to print', '150')
    .option('--format <kind>', 'json or table (default: table)')
    .action((options: CyclesOptions) => {
      const { result, lines } = runCycles(options);
      print(result, lines, wantsJson(options));
    });
};
