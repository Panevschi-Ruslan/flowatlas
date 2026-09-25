/**
 * Publishing and receiving across message transports.
 *
 * Each transport is described rather than parsed: which call publishes, which
 * argument names the channel, which decorators mark a handler. A project with
 * its own bus describes one in configuration instead.
 */
export const PACKAGE_NAME = '@flowatlas/adapters-broker';

export { brokerSpecsFor, brokersPass, extractBrokers } from './brokers-pass.js';
export { brokerAdapters, createCustomBrokerAdapter, socketio } from './adapters/index.js';
export type { BrokerSpec, ChannelPrefix, ConsumerPattern, SubscriberPattern } from './adapters/index.js';
export { hasAcknowledgement, receiverIsFrom, targetOfHandler } from './call-site.js';
export { isResolved, resolveChannelName, shapeChannelNames, trimEndpoint } from './channel-name.js';
export type {
  ChannelResolution,
  ChannelShaping,
  ChannelVia,
  ResolvedChannel,
  UnresolvedChannel,
} from './channel-name.js';
export { pairKey, readBrokerMarkers } from './markers.js';

import type { AdapterRegistry } from '@flowatlas/core';
import { brokerAdapters } from './adapters/index.js';

export const registerBrokerAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.registerAll('broker', brokerAdapters);
