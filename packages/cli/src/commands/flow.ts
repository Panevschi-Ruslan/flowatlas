import { buildFlowTree } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { openDbFromOptions, sourceRootsFor } from '../db.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { resolveEntry } from '../query/refs.js';

/**
 * Follows one entry point through everything it reaches.
 *
 * A route, a bot callback and a scheduled job all arrive here as an entry id
 * and are walked by the same code; the only thing that knows which is which is
 * the glyph at the start of the line (I8).
 */
export const runFlow = (ref: string, options: QueryOptions, io: QueryIo = processIo): void => {
  const settings = settingsFor(options, io);
  const db = openDbFromOptions(settings);
  const entry = resolveEntry(db, ref, settings.service);

  const flow = buildFlowTree(db, entry.id, {
    depth: settings.depth,
    maxNodes: settings.maxNodes,
    detail: settings.detail,
  });

  present(
    db,
    settings,
    {
      tree: flow.root,
      // Nothing unresolvable is dropped quietly: the count of findings on this
      // path is part of the answer, not a detail of the build (I3).
      footer: [`unresolved on this path: ${flow.unresolvedOnPath}`],
      extra: { entry: entry.id, unresolvedOnPath: flow.unresolvedOnPath },
      ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }),
    },
    io,
    settings.detail >= 3 ? sourceRootsFor(settings) : undefined,
  );
};

export const registerFlow = (program: Command): void => {
  withQueryOptions(
    program
      .command('flow')
      .argument('<entry>', 'an entry: "POST /orders", "bot:order_confirm", or a full entry id')
      .description('follow one entry point through every repository it reaches'),
  ).action((entry: string, options: QueryOptions) => {
    runFlow(entry, options);
  });
};
