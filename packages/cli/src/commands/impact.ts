import type { Command } from 'commander';
import { openDbFromOptions, sourceRootsFor } from '../db.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { callersOf, groupEntries, reachableSummary } from '../query/callers.js';
import { resolveSymbol } from '../query/refs.js';

export interface ImpactOptions extends QueryOptions {
  entriesOnly?: boolean;
}

/**
 * What would have to be retested if a symbol changed.
 *
 * The tree grows the other way from `flow`: the root is the thing being
 * changed and every child is something that reaches it, so the leaves are the
 * ways in that a change is visible from.
 */
export const runImpact = (
  symbol: string,
  options: ImpactOptions,
  io: QueryIo = processIo,
): void => {
  const settings = settingsFor(options, io);
  const db = openDbFromOptions(settings);
  const target = resolveSymbol(db, symbol, settings.service);

  const callers = callersOf(db, target, {
    depth: settings.depth,
    maxNodes: settings.maxNodes,
    detail: settings.detail,
    ...(options.entriesOnly === true ? { entriesOnly: true } : {}),
  });

  present(
    db,
    settings,
    {
      tree: callers.root,
      footer: [reachableSummary(callers.entries, callers.withoutEntry)],
      extra: {
        target: target.id,
        reached: callers.reached,
        reachable: groupEntries(callers.entries),
        entries: callers.entries.map((entry) => entry.id),
        services: callers.services,
        servicesWithoutEntry: callers.withoutEntry,
      },
      ...(callers.truncated === undefined ? {} : { truncated: callers.truncated }),
    },
    io,
    settings.detail >= 3 ? sourceRootsFor(settings) : undefined,
  );
};

export const registerImpact = (program: Command): void => {
  withQueryOptions(
    program
      .command('impact')
      .argument('<symbol>', 'a node id, or a unique Class.method')
      .description('every entry point that reaches a symbol, and what lies between'),
  )
    .option('--entries-only', 'list the entry points instead of the whole chain')
    .action((symbol: string, options: ImpactOptions) => {
      runImpact(symbol, options);
    });
};
