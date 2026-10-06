import type { DeployedDelivery } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { deliveryEnvelope, ENVELOPES, ONWARD } from './envelopes.js';

const delivery = (parts: Partial<DeployedDelivery> & Pick<DeployedDelivery, 'from' | 'by'>): DeployedDelivery => ({
  file: 'infra/main.tf',
  line: 1,
  address: 'x',
  to: { kind: 'function', function: 0 },
  ...parts,
});

describe('how a delivery wraps what it hands its target', () => {
  it('is the event shape of the source when the target is code', () => {
    expect(deliveryEnvelope(delivery({ by: 'mapping', from: { kind: 'queue', name: 'returns' } }))).toBe(ENVELOPES.queue);
    expect(deliveryEnvelope(delivery({ by: 'subscription', from: { kind: 'topic', name: 'returned' } }))).toBe(ENVELOPES.topic);
    expect(
      deliveryEnvelope(delivery({ by: 'rule', from: { kind: 'bus', name: 'library', pattern: { fields: {} } }, to: { kind: 'workflow', name: 'review' } })),
    ).toBe(ENVELOPES.bus);
  });

  it('is what is handed on when the target is another channel, and the message itself when raw', () => {
    const bus = { kind: 'bus', name: 'library', pattern: { fields: {} } } as const;
    expect(deliveryEnvelope(delivery({ by: 'rule', from: bus, to: { kind: 'queue', name: 'digest' } }))).toBe(ONWARD.bus);
    const topic = { kind: 'topic', name: 'returned' } as const;
    expect(deliveryEnvelope(delivery({ by: 'subscription', from: topic, to: { kind: 'queue', name: 'restock' } }))).toBe(ONWARD.topic);
    expect(
      deliveryEnvelope(delivery({ by: 'subscription', from: topic, to: { kind: 'queue', name: 'restock' }, meta: { raw: true } })),
    ).toEqual({ at: [], text: false });
  });

  it('is the message as it was sent when a rule puts the event on another bus', () => {
    const bus = { kind: 'bus', name: 'library', pattern: { fields: {} } } as const;
    expect(deliveryEnvelope(delivery({ by: 'rule', from: bus, to: { kind: 'bus', name: 'library-audit' } }))).toEqual({ at: [], text: false });
  });

  it('is not known for a rewritten input, a pipe, or a delivery whose target was not read', () => {
    const bus = { kind: 'bus', name: 'library', pattern: { fields: {} } } as const;
    expect(deliveryEnvelope(delivery({ by: 'rule', from: bus, meta: { transformed: true } }))).toBeUndefined();
    expect(deliveryEnvelope(delivery({ by: 'pipe', from: { kind: 'queue', name: 'returns' } }))).toBeUndefined();
    const { to: _unread, ...untargeted } = delivery({ by: 'mapping', from: { kind: 'queue', name: 'returns' } });
    expect(deliveryEnvelope(untargeted)).toBeUndefined();
  });
});
