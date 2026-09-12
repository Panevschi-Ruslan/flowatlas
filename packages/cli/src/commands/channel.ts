import { buildFlowTree, projectDetail, projectEdge, type FlowNode } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { openDbFromOptions, sourceRootsFor } from '../db.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { resolveChannel } from '../query/refs.js';

/** A heading in the tree, so producers and consumers are not one flat list. */
const group = (id: string, label: string, children: FlowNode[]): FlowNode => ({
  node: { id, type: 'group', label: `${label} (${children.length})` },
  children,
});

/**
 * Both ends of a channel.
 *
 * A publisher points at the channel and the channel points at a handler, so the
 * two sides are read in opposite directions and shown as one picture. A side
 * with nothing on it is the interesting case and is called out rather than
 * shown as an empty list.
 */
export const runChannel = (name: string, options: QueryOptions, io: QueryIo = processIo): void => {
  const settings = settingsFor(options, io);
  const db = openDbFromOptions(settings);
  const channel = resolveChannel(db, name);

  const producers = db
    .edgesTo(channel.id, ['emits'])
    .flatMap((edge) => {
      const publisher = db.node(edge.from);
      return publisher === undefined
        ? []
        : [
            {
              node: projectDetail(publisher, settings.detail),
              edge: projectEdge(edge, settings.detail),
              children: [],
            } satisfies FlowNode,
          ];
    })
    .sort((a, b) => (a.node.id < b.node.id ? -1 : 1));

  // The consumer side is an ordinary forward walk from the channel, so what a
  // handler goes on to do is part of the answer.
  const forward = buildFlowTree(db, channel.id, {
    depth: settings.depth,
    maxNodes: settings.maxNodes,
    detail: settings.detail,
  });

  const warnings: string[] = [];
  const mark = settings.ascii ? '!' : '⚠';
  if (producers.length === 0) warnings.push(`${mark} no producers`);
  if (forward.root.children.length === 0) warnings.push(`${mark} no consumers`);

  present(
    db,
    settings,
    {
      tree: {
        node: forward.root.node,
        children: [
          group(`${channel.id}#producers`, 'producers', producers),
          group(`${channel.id}#consumers`, 'consumers', forward.root.children),
        ],
      },
      footer: warnings,
      extra: {
        channel: channel.id,
        producers: producers.length,
        consumers: forward.root.children.length,
        ...(warnings.length === 0 ? {} : { warnings }),
      },
      ...(forward.truncated === undefined ? {} : { truncated: forward.truncated }),
    },
    io,
    settings.detail >= 3 ? sourceRootsFor(settings) : undefined,
  );
};

export const registerChannel = (program: Command): void => {
  withQueryOptions(
    program
      .command('channel')
      .argument('<name>', 'a channel name, with or without the "channel:" prefix')
      .description('who publishes to a channel and who handles it'),
  ).action((name: string, options: QueryOptions) => {
    runChannel(name, options);
  });
};
