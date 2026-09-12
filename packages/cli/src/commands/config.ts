import { FlowatlasError } from '@flowatlas/core';
import type { Command } from 'commander';
import {
  configAlongFlow,
  configEverywhere,
  type ConfigKeyRow,
  type ConfigResultBody,
} from '../analysis/config-keys.js';
import { maxRows, openProjectDb, print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { ANALYTICS_FORMAT_VERSION, type ConfigResult } from '../analysis/shapes.js';
import { moreRows, renderTable } from '../format/table.js';
import { explainSelection, resolveSelector, selectionHint } from '../query/selector.js';
import { EXIT } from '../exit.js';

export interface ConfigCommandOptions extends ReadOptions {
  all?: boolean;
  service?: string;
}

export interface ConfigRun {
  result: ConfigResult;
  lines: string[];
}

/**
 * The entry could not be pinned down, so any answer would be about the wrong
 * flow. A failed check rather than a broken tool, hence exit 1.
 */
export class SelectorError extends FlowatlasError {
  constructor(code: 'selector-not-found' | 'selector-ambiguous', message: string, hint: string) {
    super(code, message, hint);
  }
}

const keep = (
  services: Record<string, ConfigKeyRow[]>,
  only: string | undefined,
  max: number,
): { services: Record<string, ConfigKeyRow[]>; dropped: number } => {
  const kept: Record<string, ConfigKeyRow[]> = {};
  let budget = max;
  let dropped = 0;
  for (const [service, rows] of Object.entries(services)) {
    if (only !== undefined && service !== only) continue;
    const room = Math.max(budget, 0);
    const shown = rows.slice(0, room);
    if (shown.length > 0) kept[service] = shown;
    dropped += rows.length - shown.length;
    budget -= rows.length;
  }
  return { services: kept, dropped };
};

/**
 * The settings one flow needs, or every setting the project reads.
 *
 * The walk crosses services on purpose: "what does this flow need" is asked by
 * someone about to deploy it, and the answer is wrong if it stops at the first
 * repository boundary.
 */
export const runConfig = (selector: string | undefined, options: ConfigCommandOptions): ConfigRun => {
  const { db, close } = openProjectDb(options);
  try {
    const max = maxRows(options);

    if (options.all !== true && (selector === undefined || selector.trim() === '')) {
      throw new SelectorError(
        'selector-not-found',
        'name a flow, or pass --all for every key in the project',
        'flowatlas config "POST /orders"',
      );
    }

    let entry: string | undefined;
    let body: ConfigResultBody;
    if (options.all === true) {
      body = configEverywhere(db);
    } else {
      const selection = resolveSelector(db, selector!);
      if (selection.kind !== 'one') {
        throw new SelectorError(
          selection.kind === 'several' ? 'selector-ambiguous' : 'selector-not-found',
          explainSelection(selector!, selection).join('\n'),
          selectionHint(selection),
        );
      }
      entry = selection.id;
      body = configAlongFlow(db, selection.id);
    }

    const { services, dropped } = keep(body.services, options.service, max);
    const result: ConfigResult = {
      analyticsFormatVersion: ANALYTICS_FORMAT_VERSION,
      ...(entry === undefined ? {} : { flow: { selector: selector!, entry } }),
      services,
      unresolvedAlongFlow: body.unresolvedAlongFlow,
      ...(dropped > 0 ? { truncated: dropped } : {}),
      ...(body.reachTruncated === true
        ? { warnings: [{ reason: 'flow-truncated', hint: 'the walk stopped at its node limit' }] }
        : {}),
    };

    const lines: string[] = [];
    for (const [service, rows] of Object.entries(services)) {
      lines.push(`${service}:`);
      lines.push(
        ...renderTable(rows, [
          { header: 'key', value: (row) => row.key },
          { header: 'via', value: (row) => row.via },
          {
            header: 'read at',
            value: (row) =>
              row.readAt
                .map((read) => `${read.symbol}${read.file === undefined ? '' : ` (${read.file}:${read.line ?? 0})`}`)
                .join(', '),
          },
        ]).map((line) => `  ${line}`),
      );
    }
    if (lines.length === 0) lines.push('no configuration keys on this flow');
    if (dropped > 0) lines.push(moreRows(dropped));
    lines.push(
      options.all === true
        ? `${result.unresolvedAlongFlow} key(s) built at run time and not recorded`
        : `unresolvedAlongFlow: ${result.unresolvedAlongFlow}`,
    );

    return { result, lines };
  } finally {
    close();
  }
};

export const registerConfig = (program: Command): void => {
  program
    .command('config')
    .argument('[selector]', 'an entry, as an id or as "POST /orders"')
    .description('the settings one flow needs, across every service it reaches')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--all', 'every key in the project, grouped by service')
    .option('--service <name>', 'only this service')
    .option('--max <n>', 'most rows to print', '150')
    .option('--format <kind>', 'json or table (default: table)')
    .action((selector: string | undefined, options: ConfigCommandOptions) => {
      try {
        const { result, lines } = runConfig(selector, options);
        print(result, lines, wantsJson(options));
      } catch (error) {
        // A selector nobody can resolve is a failed check, not a tool that
        // could not run, so it does not share `build`'s exit code.
        if (!(error instanceof SelectorError)) throw error;
        process.stderr.write(`${error.message}\n${error.hint ?? ''}\n`);
        process.exitCode = EXIT.failed;
      }
    });
};
