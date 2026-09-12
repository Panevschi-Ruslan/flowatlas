import { makeChannelId, makeLeafId, makeSymbolId } from '@flowatlas/core';
import type { NestExtractContext } from '@flowatlas/extractor-nestjs';
import type { BrokerSpec } from './adapters/index.js';

interface RecordedMarker {
  name: string;
  args: unknown[];
}

const WALKED = new Set(['controller', 'injectable', 'guard', 'interceptor', 'pipe', 'middleware', 'plain']);

/** Key for a method and channel pair, using a separator neither can contain. */
export const pairKey = (methodId: string, channel: string): string => `${methodId} :: ${channel}`;

const channelArgOf = (marker: RecordedMarker): string | undefined => {
  const [first] = marker.args;
  return typeof first === 'string' ? first : undefined;
};

/**
 * Channels named by annotation rather than found in the code.
 *
 * An annotation exists for the places analysis is blind: a channel read from
 * settings, or a bus with no library to recognise. Where the code already says
 * the same thing the annotation adds nothing, and no second edge is drawn, so a
 * chain is never counted twice.
 */
export const readBrokerMarkers = (
  ctx: NestExtractContext,
  spec: BrokerSpec | undefined,
  alreadyStatic: ReadonlySet<string>,
): void => {
  const channelKind = spec?.channelKind ?? 'channel';
  const adapter = spec?.name ?? 'marker';

  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role)) continue;

    for (const method of indexed.declaration.getMethods()) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      const node = ctx.builder.getNode(methodId);
      const markers = node?.meta?.['markers'] as RecordedMarker[] | undefined;
      if (markers === undefined || markers.length === 0) continue;

      const line = method.getStartLineNumber();
      const file = indexed.file;

      for (const marker of markers) {
        if (marker.name !== 'Emits' && marker.name !== 'Consumes') continue;
        const channelName = channelArgOf(marker);
        if (channelName === undefined) continue;
        // The code already says this, so the annotation adds nothing here.
        if (alreadyStatic.has(pairKey(methodId, channelName))) continue;

        const channelId = makeChannelId(channelName);
        const existing = ctx.builder.getNode(channelId);
        const adapters = new Set([
          ...((existing?.meta?.['adapters'] as string[] | undefined) ?? []),
          adapter,
        ]);
        const channel = ctx.builder.addNode({
          id: channelId,
          type: 'channel',
          label: channelName,
          repo: ctx.repo,
          file,
          line,
          meta: { channelKind, adapters: [...adapters] },
        });
        channel.meta = { ...channel.meta, adapters: [...adapters] };

        if (marker.name === 'Emits') {
          const producerId = makeLeafId('producer', ctx.repo, file, line, 0);
          ctx.builder.addNode({
            id: producerId,
            type: 'producer',
            label: `event ${channelName}`,
            repo: ctx.repo,
            file,
            line,
            kind: 'event',
            meta: { kind: 'event', adapter, channelVia: 'marker', method: 'Emits' },
          });
          ctx.builder.addEdge({
            from: methodId,
            to: producerId,
            type: 'calls',
            confidence: 'marker',
            file,
            line,
          });
          ctx.builder.addEdge({
            from: producerId,
            to: channelId,
            type: 'emits',
            confidence: 'marker',
            file,
            line,
          });
          continue;
        }

        const consumerId = `consumer:${makeSymbolId(ctx.repo, file, indexed.name, method.getName())}`;
        ctx.builder.addNode({
          id: consumerId,
          type: 'consumer',
          label: `${indexed.name}.${method.getName()}`,
          repo: ctx.repo,
          file,
          line,
          kind: 'event',
          meta: { kind: 'event', adapter, decorator: 'Consumes', entryId: null },
        });
        ctx.ensureMethodNode(method);
        ctx.builder.addEdge({
          from: channelId,
          to: consumerId,
          type: 'consumes',
          confidence: 'marker',
          file,
          line,
        });
        ctx.builder.addEdge({
          from: consumerId,
          to: methodId,
          type: 'handles',
          confidence: 'marker',
          file,
          line,
        });
      }
    }
  }
};
