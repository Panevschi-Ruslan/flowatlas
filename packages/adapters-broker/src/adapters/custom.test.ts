import { parseConfig } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { createCustomBrokerAdapter } from './index.js';

/** The configuration as a person writes it, through the schema that validates it. */
const busFrom = (entry: Record<string, unknown>) =>
  createCustomBrokerAdapter(
    parseConfig({ adapters: { broker: { custom: [entry] } } }).adapters.broker.custom[0]!,
  );

describe('a bus described in configuration', () => {
  it('turns a subscriber into the call pattern the pass looks for', () => {
    const bus = busFrom({
      name: 'house-bus',
      subscribers: [
        { receiverType: ['Broadcaster'], method: 'pSubscribe', channelArg: 0, handlerArg: 1 },
      ],
    });
    expect(bus.subscriberPatterns).toEqual([
      {
        method: 'pSubscribe',
        channelArg: 0,
        handlerArg: 1,
        receiverType: ['Broadcaster'],
        kind: 'event',
      },
    ]);
  });

  it('leaves the handler out when the call does not take one', () => {
    const bus = busFrom({
      name: 'house-bus',
      subscribers: [{ receiverType: 'Broadcaster', method: 'listen' }],
    });
    expect(bus.subscriberPatterns?.[0]).not.toHaveProperty('handlerArg');
    expect(bus.subscriberPatterns?.[0]?.channelArg).toBe(0);
  });

  // A bus with no receiving side described is still a bus. Saying nothing here is
  // what leaves its channels reading as publishers with no handlers, which is a
  // fact about the configuration rather than about the project (R08).
  it('describes no subscriptions when the configuration names none', () => {
    expect(busFrom({ name: 'house-bus' }).subscriberPatterns).toEqual([]);
  });

  it('refuses a subscriber that names no receiving type', () => {
    expect(() =>
      busFrom({ name: 'house-bus', subscribers: [{ method: 'pSubscribe' }] }),
    ).toThrow(/receiverType/);
  });
});
