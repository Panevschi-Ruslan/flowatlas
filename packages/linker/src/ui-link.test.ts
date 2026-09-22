import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { callPerChoice, missingChoiceFinding } from './ui-link.js';

const call = (meta: Record<string, unknown>): GraphNode => ({
  id: 'ui_api_call:web#src/app/orders.client.ts:12:4',
  type: 'ui_api_call',
  label: 'POST /orders/:param/:param',
  repo: 'web',
  kind: 'http',
  meta: { method: 'POST', path: '/orders/:param/:param', ...meta },
});

/**
 * One call written, as the several addresses it stands for (R31).
 *
 * The expansion itself is a rewrite of one field, and it has to leave
 * everything else alone: an edge drawn from a copy is drawn from the call
 * somebody wrote, so the id may not move.
 */
describe('a call whose last segment is a closed set', () => {
  it('answers with one copy per value, each carrying its own address', () => {
    const copies = callPerChoice(
      call({ pathChoices: ['/orders/:param/ship', '/orders/:param/refund'] }),
    );
    expect(copies?.map((copy) => copy.meta?.['path'])).toEqual([
      '/orders/:param/ship',
      '/orders/:param/refund',
    ]);
  });

  it('keeps the id of the call that was written', () => {
    const copies = callPerChoice(
      call({ pathChoices: ['/orders/:param/ship', '/orders/:param/refund'] }),
    );
    expect(new Set(copies?.map((copy) => copy.id))).toEqual(
      new Set(['ui_api_call:web#src/app/orders.client.ts:12:4']),
    );
  });

  it('answers with nothing for a call that has no such segment', () => {
    // Which is nearly every call, and why asking is free.
    expect(callPerChoice(call({}))).toBeUndefined();
    expect(callPerChoice(call({ pathChoices: ['/orders/:param/only'] }))).toBeUndefined();
    expect(callPerChoice(call({ pathChoices: ['/a', 7] }))).toBeUndefined();
  });

  it('names the value that reaches nothing, and the ones that do', () => {
    const finding = missingChoiceFinding('POST', ['/orders/:param/hold'], ['/orders/:param/resume']);
    expect(finding.message).toBe(
      'POST /orders/:param/hold reaches no route, though /orders/:param/resume does',
    );
    expect(finding.reason).toBe('target-route-not-found');
  });
});
