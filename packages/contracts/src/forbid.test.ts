import type { TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { diffTypes } from './compare.js';
import { severityOf } from './severity.js';
import { field, object } from './test-graph.js';

/** A validation pipe told to refuse rather than strip (P388): `forbidNonWhitelisted`. */
describe('a field the receiver forbids', () => {
  const registry: TypeRegistry = {};
  const sender = object('Sent', [field('item', 'string'), field('giftNote', 'string')], registry);
  const receiver = object('CreateOrderDto', [field('item', 'string', false, { validators: ['IsString'] })], registry);

  it('is refused with 400 under forbidNonWhitelisted, and stripped under whitelist alone', () => {
    const refused = diffTypes(sender, receiver, (id) => registry[id], { whitelist: true, forbid: true }).diffs;
    expect(refused.map((diff) => [diff.path, diff.rule])).toEqual([['giftNote', 'whitelist-reject']]);
    expect(refused[0]?.note).toContain('refused with 400');
    const stripped = diffTypes(sender, receiver, (id) => registry[id], { whitelist: true }).diffs;
    expect(stripped.map((diff) => diff.rule)).toEqual(['whitelist-strip']);
    // `forbid` means nothing without the whitelist it refuses by.
    expect(diffTypes(sender, receiver, (id) => registry[id], { forbid: true }).diffs.map((diff) => diff.rule)).toEqual([null]);
  });

  it('is an error, whatever the handler writes: the request fails with 400', () => {
    expect(severityOf('extra_field', 'whitelist-reject')).toBe('error');
    expect(severityOf('extra_field', 'whitelist-reject', 'none')).toBe('error');
  });
});
