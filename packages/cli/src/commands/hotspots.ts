import type { Command } from 'commander';
import { inDegree, type DegreeRow } from '../analysis/degree.js';
import { loadGraph } from '../analysis/graph.js';
import { maxRows, openProjectDb, print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { ANALYTICS_FORMAT_VERSION, type HotspotsResult } from '../analysis/shapes.js';
import { moreRows, renderTable } from '../format/table.js';

/**
 * Edges that count toward being depended upon.
 *
 * `imports` and `reads_config` are left out deliberately: a settings key read
 * forty times is not fragile, and a module everything imports is a fact about
 * Nest rather than about this project.
 */
export const HOTSPOT_EDGES = ['calls', 'http_calls', 'hits', 'consumes', 'injects'] as const;

export interface HotspotsOptions extends ReadOptions {
  top?: string | number;
  type?: string[];
  edge?: string[];
  crossService?: boolean;
}

export interface HotspotsRun {
  result: HotspotsResult;
  lines: string[];
}

export const runHotspots = (options: HotspotsOptions): HotspotsRun => {
  const { db, close } = openProjectDb(options);
  try {
    const max = maxRows(options);
    const top = options.top === undefined ? 20 : Math.max(Number(options.top), 1);
    const edgeTypes = options.edge === undefined || options.edge.length === 0 ? HOTSPOT_EDGES : options.edge;

    const graph = loadGraph(db, { edgeTypes });
    const ranked = inDegree(graph, {
      ...(options.type === undefined ? {} : { types: options.type }),
      ...(options.crossService === true ? { crossService: true } : {}),
    });

    // `--top` is a choice about how many to look at; `--max` is the cap on what
    // may be printed. Only the second one is truncation.
    const wanted = Math.min(top, ranked.length);
    const shown = ranked.slice(0, Math.min(wanted, max));

    const result: HotspotsResult = {
      analyticsFormatVersion: ANALYTICS_FORMAT_VERSION,
      rows: shown,
      ranked: ranked.length,
      ...(wanted > shown.length ? { truncated: wanted - shown.length } : {}),
    };

    const lines =
      shown.length === 0
        ? ['nothing has an incoming edge of these types']
        : renderTable(shown, [
            { header: 'in', value: (row: DegreeRow) => String(row.inDegree), align: 'right' },
            { header: 'services', value: (row) => String(row.callerServices.length), align: 'right' },
            { header: 'type', value: (row) => row.type },
            { header: 'node', value: (row) => row.id },
            {
              header: 'by edge',
              value: (row) =>
                Object.entries(row.byEdgeType)
                  .map(([type, count]) => `${type}:${count}`)
                  .join(' '),
            },
            { header: 'called from', value: (row) => row.callerServices.join(',') },
          ]);
    if (result.truncated !== undefined) lines.push(moreRows(result.truncated));
    lines.push(`${ranked.length} node(s) have anything pointing at them`);

    return { result, lines };
  } finally {
    close();
  }
};

export const registerHotspots = (program: Command): void => {
  const repeatable = (value: string, previous: string[] = []): string[] => [...previous, value];

  program
    .command('hotspots')
    .description('nodes the most things point at: where a change is felt')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--top <n>', 'how many to rank', '20')
    .option('--type <nodeType>', 'only this node type (repeatable)', repeatable)
    .option('--edge <edgeType>', `edges that count (repeatable, default ${HOTSPOT_EDGES.join(',')})`, repeatable)
    .option('--cross-service', 'rank by how many services reach it, not by how many edges')
    .option('--max <n>', 'most rows to print', '150')
    .option('--format <kind>', 'json or table (default: table)')
    .action((options: HotspotsOptions) => {
      const { result, lines } = runHotspots(options);
      print(result, lines, wantsJson(options));
    });
};
