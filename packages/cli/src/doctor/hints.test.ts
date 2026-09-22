import type { GraphNode, Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  answeredByMarker,
  genericHint,
  hintFor,
  isKnownReason,
  HINTS,
  kindHint,
  KIND_HINTS,
  KNOWN_REASONS,
  MARKER_ANSWERS,
  type MarkerGraph,
} from './hints.js';

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

describe('the sentence a whole group is headed with', () => {
  it('says something about every reason it knows, with nothing of one place in it', () => {
    for (const reason of KNOWN_REASONS) {
      const hint = kindHint(reason);
      expect(hint, reason).toBeDefined();
      expect((hint as string).length, reason).toBeGreaterThan(20);
    }
  });

  it('is written out by hand wherever the catalogue would have quoted a row', () => {
    // A template that answers differently for a row with a symbol and a row
    // without one is a template about a member, and a heading may not be about
    // a member (R35). Every one of them is written again in the general.
    const withSymbol = (reason: string) => HINTS[reason]?.(row({ reason, symbol: 'ZZ_TOKEN' }), {});
    const without = (reason: string) => HINTS[reason]?.(row({ reason, symbol: undefined }), {});
    for (const reason of KNOWN_REASONS) {
      if (withSymbol(reason) === without(reason)) continue;
      expect(KIND_HINTS[reason], `${reason} interpolates its row and needs a kind hint`).toBeDefined();
      expect(kindHint(reason), reason).not.toContain('ZZ_TOKEN');
    }
  });

  it('has nothing to say about a reason nobody registered', () => {
    expect(kindHint('something-new')).toBeUndefined();
  });

  it('names the token in a row and not in the heading it sits under', () => {
    // The fault this exists for: two rows of one reason, each about a different
    // token, and one of the two tokens hoisted into the heading (R35).
    const one = hintFor(row({ reason: 'di-token-unknown', symbol: 'BILLING_CLIENT' }));
    const other = hintFor(row({ reason: 'di-token-unknown', symbol: 'ORDERS_CLIENT' }));
    expect(one).toContain('BILLING_CLIENT');
    expect(other).toContain('ORDERS_CLIENT');
    const heading = kindHint('di-token-unknown') as string;
    expect(heading).not.toContain('BILLING_CLIENT');
    expect(heading).not.toContain('ORDERS_CLIENT');
  });
});

describe('a row an annotation has already answered', () => {
  /** A graph where every edge asked for is there, at the confidence given. */
  const all = (confidence: string): MarkerGraph => ({
    edgesFrom: (id) => [{ to: `${id}/out`, confidence }],
    edgesTo: (id) => [{ from: `${id}/in`, confidence }],
  });
  const nothing: MarkerGraph = { edgesFrom: () => [], edgesTo: () => [] };
  const marker = all('marker');

  it('is answered when the edge the annotation draws is there', () => {
    expect(answeredByMarker('dynamic-http-url', 'http_out:x', marker)).toBe(true);
  });

  it('is not answered by an edge nothing asserted', () => {
    // A guess that landed in the right place is not an annotation, and the row
    // still asks for one.
    expect(answeredByMarker('dynamic-http-url', 'http_out:x', all('heuristic'))).toBe(false);
  });

  it('is not answered when there is no node to ask about', () => {
    expect(answeredByMarker('dynamic-http-url', undefined, marker)).toBe(false);
  });

  it('leaves a reason no annotation can answer alone', () => {
    // `db-receiver-name-only` is settled by configuration, not by a marker, so
    // no edge in the graph can ever make it finished.
    expect(answeredByMarker('db-receiver-name-only', 'x', marker)).toBe(false);
  });

  it('wants both edges of a publish, not just one', () => {
    // `@Emits` gives the method a producer and the producer a channel. A method
    // that calls a producer which emits nothing has not been annotated; looking
    // only for an `emits` edge out of the method finds nothing either way,
    // which is how a row an annotation had answered kept asking (R37).
    const half: MarkerGraph = {
      edgesFrom: (id, types) =>
        (types ?? []).includes('calls') ? [{ to: 'producer:x', confidence: 'marker' }] : [],
      edgesTo: () => [],
    };
    expect(answeredByMarker('channel-const-unresolved', 'm', half)).toBe(false);
    expect(answeredByMarker('channel-const-unresolved', 'm', marker)).toBe(true);
  });

  it('answers a subscribe from the other end', () => {
    // `@Consumes` points the other way: the channel reaches a consumer, and the
    // consumer hands to the method.
    const subscribing: MarkerGraph = {
      edgesFrom: () => [],
      edgesTo: (id, types) =>
        (types ?? []).includes('handles') || (types ?? []).includes('consumes')
          ? [{ from: `${id}/in`, confidence: 'marker' }]
          : [],
    };
    expect(answeredByMarker('channel-dynamic', 'm', subscribing)).toBe(true);
    expect(answeredByMarker('channel-dynamic', 'm', nothing)).toBe(false);
  });

  /**
   * A browser request, where the annotation adds a call rather than repairing
   * one — so the row's own node can never carry the edge (R39).
   */
  const browser = (calls: Array<{ id: string; marker?: boolean; joined?: boolean }>): MarkerGraph => ({
    edgesFrom: (id, types) => {
      if (id === 'method' && (types ?? []).includes('calls')) {
        return calls.map((call) => ({ to: call.id, confidence: call.marker === true ? 'marker' : 'static' }));
      }
      const found = calls.find((call) => call.id === id);
      if (found?.joined === true && (types ?? []).includes('hits')) {
        return [{ to: 'entry:x', confidence: 'static' }];
      }
      return [];
    },
    edgesTo: (id, types) =>
      (types ?? []).includes('calls') && calls.some((call) => call.id === id)
        ? [{ from: 'method', confidence: 'static' }]
        : [],
    node: (id) =>
      calls.some((call) => call.id === id)
        ? ({
            id,
            type: 'ui_api_call',
            label: id,
            repo: 'web',
            meta: calls.find((call) => call.id === id)?.marker === true ? { via: 'marker' } : {},
          } as GraphNode)
        : undefined,
  });

  it('answers an unread request when the annotation can be about nothing else', () => {
    const graph = browser([
      { id: 'blind' },
      { id: 'asserted', marker: true, joined: true },
    ]);
    expect(answeredByMarker('api-path-dynamic', 'blind', graph)).toBe(true);
    expect(answeredByMarker('api-method-dynamic', 'blind', graph)).toBe(true);
  });

  it('leaves both rows when one annotation could be about either request', () => {
    // Silencing both would hide a real gap behind an annotation that was never
    // about it, which is the fault this release exists to stop.
    const graph = browser([
      { id: 'blind' },
      { id: 'blind2' },
      { id: 'asserted', marker: true, joined: true },
    ]);
    expect(answeredByMarker('api-path-dynamic', 'blind', graph)).toBe(false);
    expect(answeredByMarker('api-path-dynamic', 'blind2', graph)).toBe(false);
  });

  it('answers both when there is an annotation for each', () => {
    const graph = browser([
      { id: 'blind' },
      { id: 'blind2' },
      { id: 'a1', marker: true, joined: true },
      { id: 'a2', marker: true, joined: true },
    ]);
    expect(answeredByMarker('api-path-dynamic', 'blind', graph)).toBe(true);
  });

  it('is not answered by a request that simply read cleanly', () => {
    // A method with a readable request and an unreadable one has not been
    // annotated at all, and the row still asks for it.
    const graph = browser([{ id: 'blind' }, { id: 'readable', joined: true }]);
    expect(answeredByMarker('api-path-dynamic', 'blind', graph)).toBe(false);
  });

  it('asks the question of every kind a marker can answer', () => {
    // The catalogue is the list; this is here so that adding a marker without
    // adding it to the list is a failing test rather than a silent row.
    for (const reason of Object.keys(MARKER_ANSWERS)) {
      expect(isKnownReason(reason), reason).toBe(true);
      expect(answeredByMarker(reason, 'x', nothing), reason).toBe(false);
    }
  });
});
