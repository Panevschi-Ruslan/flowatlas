import type { CallPattern, StarterConfig } from '@flowatlas/core';
import type { BrokerSpec } from './types.js';

/**
 * Calls described in configuration that start a workflow or invoke a function
 * by its deployed name (P24).
 *
 * The fourth kind of description, beside the broker, the registry and the HTTP
 * one, and deliberately not a `broker.custom` producer. Starting a workflow is
 * not publishing: there is exactly one receiver, addressed by a name the
 * deployment owns, and the call often waits for it. Folded into the broker
 * description, every state machine would be a channel and every function a
 * consumer of one, and the reverse walk and `dead` would answer about them in
 * channel terms. That the thing described is not a message is the whole of
 * the justification P20 asks a fourth description for.
 *
 * What it compiles into is the vocabulary the SDK's own starters are written
 * in - a call pattern that `starts` - so the one reader reads both, and a
 * helper described here and the SDK call inside it, read where its source is
 * here, arrive at the same reference.
 */
const patternOf = (starter: StarterConfig): CallPattern => ({
  // The schema has already refused a starter that is neither a function nor a method.
  ...(starter.function === undefined
    ? {
        method: starter.method ?? '',
        ...(starter.receiverType === undefined ? {} : { receiverType: starter.receiverType }),
        ...(starter.module === undefined ? {} : { receiverPackages: [starter.module] }),
      }
    : { method: starter.function, calledAs: 'function' as const, ...(starter.module === undefined ? {} : { module: starter.module }) }),
  channelArg: -1,
  channel: starter.name,
  kind: starter.kind ?? (starter.target === 'workflow' ? 'start' : 'invoke'),
  starts: { entry: starter.target, ...(starter.names === undefined ? {} : { names: starter.names }) },
});

export const createStarterAdapter = (starters: readonly StarterConfig[]): BrokerSpec => ({
  name: 'starters',
  detect: () => true,
  producerPatterns: starters.map(patternOf),
  consumerDecorators: [],
  consumerPatterns: [],
  // A start names no channel, so this is never read.
  channelKind: 'channel',
});
