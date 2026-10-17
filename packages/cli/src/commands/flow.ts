import type { GraphEdge } from '@flowatlas/core';
import { SEQUENCE_DETAILS, type SequenceDetail } from '@flowatlas/linker';
import { buildFlowTree, type FlowNode } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { openDbFromOptions, sourceRootsFor } from '../db.js';
import { cannotRun } from '../exit.js';
import { FLOW_FORMATS, withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { resolveEntry } from '../query/refs.js';
import { SEQUENCE_WALK_DETAIL, sequenceDepth, sitesFrom, stopsIn } from '../query/sequence.js';

export interface FlowOptions extends QueryOptions {
  /** `service` (the default) or `class`: what a participant of `--format sequence` is (P116). */
  sequenceDetail?: string;
}

/** `--sequence-detail`, checked: one participant per service unless asked for classes (D1). */
export const sequenceDetailOf = (value: string | undefined): SequenceDetail => {
  if (value === undefined) return 'service';
  const found = SEQUENCE_DETAILS.find((detail) => detail === value);
  if (found === undefined) {
    throw cannotRun(`--sequence-detail must be one of ${SEQUENCE_DETAILS.join(', ')}, not ${JSON.stringify(value)}`);
  }
  return found;
};

/**
 * Follows one entry point through everything it reaches.
 *
 * A route, a bot callback and a scheduled job all arrive here as an entry id
 * and are walked by the same code; the only thing that knows which is which is
 * the glyph at the start of the line (I8).
 */
export const runFlow = (ref: string, options: FlowOptions, io: QueryIo = processIo): void => {
  const settings = settingsFor(options, io, FLOW_FORMATS);
  const db = openDbFromOptions(settings);
  const entry = resolveEntry(db, ref, settings.service);
  const sequence = settings.format === 'sequence';
  const sequenceDetail = sequenceDetailOf(options.sequenceDetail);

  // A sequence is the walk `diff` draws for a changed flow, so it is read the
  // same way: with the edge behind each row, at the detail a participant needs.
  const edgesOf = sequence ? new Map<FlowNode, GraphEdge>() : undefined;
  const flow = buildFlowTree(db, entry.id, {
    // Without `--depth` the walk goes as far as the entry needs: a workflow is
    // walked through every step and into what each reaches (`defaultFlowDepth`);
    // a sequence as far as `diff` walks one (`sequenceDepth`).
    ...(options.depth !== undefined ? { depth: settings.depth } : sequence ? { depth: sequenceDepth(db.node(entry.id)) } : {}),
    maxNodes: settings.maxNodes,
    detail: sequence ? SEQUENCE_WALK_DETAIL : settings.detail,
    ...(edgesOf === undefined ? {} : { edgesOf }),
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
      ...(edgesOf === undefined ? {} : { siteOf: sitesFrom(edgesOf), stopOf: stopsIn(db), sequenceDetail }),
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
    { formats: FLOW_FORMATS },
  )
    .option('--sequence-detail <level>', `with --format sequence, one participant per ${SEQUENCE_DETAILS.join(' or per ')}`)
    .action((entry: string, options: FlowOptions) => {
      runFlow(entry, options);
    });
};
