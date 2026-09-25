import {
  makeChannelId,
  makeLeafId,
  makeSymbolId,
  methodsOfClass,
  namesGivenTo,
  type RecordedMarker,
} from '@flowatlas/core';
import type { PassContext } from '@flowatlas/extract-scopes';
import type { BrokerSpec } from './adapters/index.js';

const WALKED = new Set(['controller', 'injectable', 'guard', 'interceptor', 'pipe', 'middleware', 'plain']);

/** Key for a method and channel pair, using a separator neither can contain. */
export const pairKey = (methodId: string, channel: string): string => `${methodId} :: ${channel}`;

/**
 * Every channel one method's annotations name, by whether it publishes or reads.
 *
 * Gathered for the method rather than for each annotation, because a stack of
 * six `@Emits` and one `@Emits` of six are the same claim written two ways, and
 * the graph should not be able to tell them apart. Arguments that name nothing
 * are left here: `doctor` is where an annotation is held to account, and
 * reporting them twice would put the same mistake in two sections.
 */
const channelsOn = (markers: readonly RecordedMarker[]): { emits: string[]; consumes: string[] } => {
  const emits: string[] = [];
  const consumes: string[] = [];
  for (const marker of markers) {
    if (marker.name !== 'Emits' && marker.name !== 'Consumes') continue;
    const into = marker.name === 'Emits' ? emits : consumes;
    for (const name of namesGivenTo(marker).names) {
      if (!into.includes(name)) into.push(name);
    }
  }
  return { emits, consumes };
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
  ctx: PassContext,
  spec: BrokerSpec | undefined,
  alreadyStatic: ReadonlySet<string>,
): void => {
  const channelKind = spec?.channelKind ?? 'channel';
  const adapter = spec?.name ?? 'marker';

  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role)) continue;

    for (const method of methodsOfClass(indexed.declaration)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      const node = ctx.builder.getNode(methodId);
      const markers = node?.meta?.['markers'] as RecordedMarker[] | undefined;
      if (markers === undefined || markers.length === 0) continue;

      const line = method.getStartLineNumber();
      const file = indexed.file;

      const { emits, consumes } = channelsOn(markers);

      /** The channel node, shared by every annotation and every adapter that names it. */
      const channelNodeFor = (channelName: string): string => {
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
        return channelId;
      };

      // The code already says this, so the annotation adds nothing for it.
      const published = emits.filter((name) => !alreadyStatic.has(pairKey(methodId, name)));
      const received = consumes.filter((name) => !alreadyStatic.has(pairKey(methodId, name)));

      if (published.length > 0) {
        // One publish site, however many channels it was annotated with: the
        // id has always been the method's line, so a stack of annotations
        // shared a producer already, and a list must not read differently.
        const producerId = makeLeafId('producer', ctx.repo, file, line, 0);
        ctx.builder.addNode({
          id: producerId,
          type: 'producer',
          label: `event ${published.join(', ')}`,
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
        for (const name of published) {
          ctx.builder.addEdge({
            from: producerId,
            to: channelNodeFor(name),
            type: 'emits',
            confidence: 'marker',
            file,
            line,
          });
        }
      }

      if (received.length > 0) {
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
        for (const name of received) {
          ctx.builder.addEdge({
            from: channelNodeFor(name),
            to: consumerId,
            type: 'consumes',
            confidence: 'marker',
            file,
            line,
          });
        }
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
