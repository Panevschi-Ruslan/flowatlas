import type { GraphNode, Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { genericHint, hintFor, isKnownReason, KNOWN_REASONS } from './hints.js';

const row = (over: Partial<Unresolved> = {}): Unresolved => ({
  service: 'orders',
  file: 'src/orders.service.ts',
  line: 12,
  reason: 'dynamic-http-url',
  ...over,
});

describe('the advice beside a row', () => {
  it('has something to say about every reason it claims to know', () => {
    for (const reason of KNOWN_REASONS) {
      const hint = hintFor(row({ reason }));
      expect(hint.length, reason).toBeGreaterThan(20);
      // Advice that names no action is not advice.
      expect(hint, reason).toMatch(/[a-z]/);
    }
  });

  it('keeps what the graph said over what the catalog would have said', () => {
    // The pass that raised the row knew something about that row in particular;
    // the catalog only knows the reason.
    const said = 'Add ORDERS_URL to services[].baseUrlEnv of whichever service answers it.';
    expect(hintFor(row({ hint: said }))).toBe(said);
  });

  it('still answers for a reason it has never heard of', () => {
    const hint = hintFor(row({ reason: 'something-new' }));
    expect(hint).toBe(genericHint('something-new'));
    expect(isKnownReason('something-new')).toBe(false);
  });

  it('says nothing to do when the call reached a route in the end', () => {
    // An annotation answered it, so the address being unreadable costs nothing
    // and telling somebody to go and fix it would be wrong.
    const node: GraphNode = {
      id: 'http_out:orders#src/orders.service.ts:12:4',
      type: 'http_out',
      label: 'POST /orders',
      repo: 'orders',
      meta: { targetService: 'billing' },
    };
    const hint = hintFor(row({ reason: 'dynamic-http-url' }), { node, joined: true });
    expect(hint.toLowerCase()).toContain('nothing to do');
  });
});
