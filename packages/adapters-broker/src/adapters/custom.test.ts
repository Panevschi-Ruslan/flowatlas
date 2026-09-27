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

  it('carries a producer’s locators through to the pattern', () => {
    const bus = busFrom({
      name: 'house-jobs',
      producers: [
        {
          receiverType: 'JobBus',
          method: 'queue',
          channel: [{ kind: 'argument-property', index: 0, key: 'name' }],
          payloadArg: 0,
          kind: 'job',
        },
      ],
    });
    expect(bus.producerPatterns[0]?.channel).toEqual([
      { kind: 'argument-property', index: 0, key: 'name' },
    ]);
  });

  // The shorthand and the list are one statement, so a description that gives
  // neither still reads as "argument 0" and a description that gives the index
  // reads as the locator it stands for.
  it('leaves the locators out when a producer names its channel by index', () => {
    const bus = busFrom({
      name: 'house-bus',
      producers: [{ receiverType: 'EventBus', method: 'publish', channelArg: 1 }],
    });
    expect(bus.producerPatterns[0]).not.toHaveProperty('channel');
    expect(bus.producerPatterns[0]?.channelArg).toBe(1);
  });

  it('reads a consumer named as a bare decorator as the shape it always meant', () => {
    const bus = busFrom({ name: 'house-bus', consumers: ['OnEvent'] });
    expect(bus.consumerDecorators).toEqual(['OnEvent']);
    expect(bus.consumerPatterns).toEqual([
      { decorator: 'OnEvent', channel: [{ kind: 'argument', index: 0 }], kind: 'event' },
    ]);
  });

  /**
   * The half of R86 the receiving side needed. Before this, a project whose
   * handlers are marked `@OnJob({ name: … })` could describe its publishers and
   * not its handlers, so every channel it had came out with one end.
   */
  it('reads a consumer written out, with the channel inside an options object', () => {
    const bus = busFrom({
      name: 'house-jobs',
      consumers: [
        {
          decorator: 'OnJob',
          channel: [{ kind: 'argument-property', index: 0, key: 'name' }],
          kind: 'job',
        },
      ],
    });
    expect(bus.consumerDecorators).toEqual(['OnJob']);
    expect(bus.consumerPatterns[0]?.channel).toEqual([
      { kind: 'argument-property', index: 0, key: 'name' },
    ]);
    expect(bus.consumerPatterns[0]?.kind).toBe('job');
  });

  it('refuses a locator kind nobody implements', () => {
    expect(() =>
      busFrom({
        name: 'house-bus',
        producers: [
          { receiverType: 'EventBus', method: 'publish', channel: [{ kind: 'guesswork' }] },
        ],
      }),
    ).toThrow();
  });
});
