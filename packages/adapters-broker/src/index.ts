/**
 * Publishing and receiving across message transports.
 *
 * Each transport is described rather than parsed: which call publishes, which
 * argument names the channel, which decorators mark a handler. A project with
 * its own bus describes one in configuration instead.
 */
export const PACKAGE_NAME = '@flowatlas/adapters-broker';

export { brokerSpecsFor, brokersPass, extractBrokers } from './brokers-pass.js';
export { brokerAdapters, createCustomBrokerAdapter } from './adapters/index.js';
export type { BrokerSpec, ConsumerPattern } from './adapters/index.js';
export { isResolved, resolveChannelName } from './channel-name.js';
export type { ChannelResolution, ChannelVia, ResolvedChannel, UnresolvedChannel } from './channel-name.js';
export { pairKey, readBrokerMarkers } from './markers.js';

import type { AdapterRegistry } from '@flowatlas/core';
import { brokerAdapters } from './adapters/index.js';

export const registerBrokerAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.registerAll('broker', brokerAdapters);
