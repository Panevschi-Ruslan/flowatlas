import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  callPerChoice,
  missingChoiceFinding,
  resolveUiCall,
  uiFindingFor,
  type UiIndex,
} from './ui-link.js';

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

/** A route of one service, in the shape the merged graph holds it. */
const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

/**
 * The four lookups, from a plain table of who serves what.
 *
 * Written out here rather than built from a project, because the question below
 * is about the order the ways are tried in and about nothing else.
 */
const indexOf = (
  routes: Record<string, readonly GraphNode[]>,
  named: Record<string, string> = {},
  claims: Record<string, readonly string[]> = {},
): UiIndex => ({
  routesOf: (service) => routes[service],
  targetOf: (repo, env) => named[`${repo}\0${env}`],
  claimantsOf: (env) => claims[env] ?? [],
  services: () => Object.keys(routes).sort(),
});

/** A request written in a browser, relative unless a settings key is given. */
const uiCall = (
  repo: string,
  method: string,
  path: string,
  meta: Record<string, unknown> = {},
): GraphNode => ({
  id: `ui_api_call:${repo}#src/app/panel.tsx:3:2`,
  type: 'ui_api_call',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path, ...meta },
});

/**
 * Which service answers a request a browser made, and in what order that is
 * decided (R93).
 *
 * The caller's own service used to be the one service struck out of the
 * question, which is why every one of these is about where it sits in the order
 * rather than about matching a path.
 */
describe('a request a browser makes of the service it was served from', () => {
  it('reaches that service, and says the reading was of one repository', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/cancel'),
      indexOf({ web: [route('web', 'POST', '/api/cancel')] }),
    );
    expect(outcome.kind).toBe('linked');
    if (outcome.kind !== 'linked') return;
    expect(outcome.via).toBe('same-service');
    expect(outcome.targetService).toBe('web');
  });

  it('is preferred to a second service that happens to serve the same address', () => {
    // Both could answer. The one the call was written in is not a guess, and
    // guessing between the two would have made this ambiguous instead.
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things'),
      indexOf({
        api: [route('api', 'GET', '/api/things')],
        web: [route('web', 'GET', '/api/things')],
      }),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('same-service');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('web');
  });

  it('gives way to what the configuration names outright', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things', { baseUrlEnv: 'API_URL' }),
      indexOf(
        { api: [route('api', 'GET', '/api/things')], web: [route('web', 'GET', '/api/things')] },
        { 'web\0API_URL': 'api' },
      ),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('api-target');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('api');
  });

  it('gives way to the one service claiming the settings key as its base', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/things', { baseUrlEnv: 'API_URL' }),
      indexOf(
        { api: [route('api', 'GET', '/api/things')], web: [route('web', 'GET', '/api/things')] },
        {},
        { API_URL: ['api'] },
      ),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('base-url-env');
  });

  it('does not stop the search when its own service serves no such address', () => {
    // A frontend that also serves routes may still be calling somebody else's,
    // so a genuine cross-service request resolves exactly as it did before.
    const outcome = resolveUiCall(
      uiCall('web', 'GET', '/api/orders'),
      indexOf({
        api: [route('api', 'GET', '/api/orders')],
        web: [route('web', 'GET', '/api/session')],
      }),
    );
    expect(outcome.kind === 'linked' && outcome.via).toBe('unique-route');
    expect(outcome.kind === 'linked' && outcome.targetService).toBe('api');
  });

  it('still says so when nothing anywhere serves the address', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/cancel'),
      indexOf({ web: [route('web', 'GET', '/api/session')] }),
    );
    expect(outcome.kind).toBe('noRoute');
    expect(uiFindingFor(outcome)?.message).toBe('no configured service serves POST /api/cancel');
  });

  it('names the verbs its own service does answer that path with', () => {
    const outcome = resolveUiCall(
      uiCall('web', 'POST', '/api/things'),
      indexOf({ web: [route('web', 'GET', '/api/things'), route('web', 'DELETE', '/api/things')] }),
    );
    expect(outcome.kind === 'noRoute' && outcome.verbs).toEqual(['DELETE', 'GET']);
    expect(uiFindingFor(outcome)?.hint).toContain('That path answers DELETE, GET.');
  });

  /**
   * A browser asking a service that creates two applications (R119).
   *
   * The interesting half is that the service is still found. Asking for a single
   * match struck a service whose own entries tie out of the search for who
   * answers, and the request then came back as one no configured service serves —
   * false, and pointing at the configuration rather than at the two applications.
   */
  describe('two applications of one service answering', () => {
    const inApplication = (repo: string, path: string, application: string): GraphNode => ({
      id: `entry:${repo}@${application}:http:GET:${path}`,
      type: 'entry',
      kind: 'http',
      label: `GET ${path} (${application})`,
      repo,
      meta: { method: 'GET', path, application },
    });

    it('names the applications rather than blaming the configuration', () => {
      const outcome = resolveUiCall(
        uiCall('web', 'GET', '/health'),
        indexOf({
          api: [
            inApplication('api', '/health', 'ApiModule'),
            inApplication('api', '/health', 'WorkerModule'),
          ],
          web: [],
        }),
      );
      expect(outcome.kind).toBe('ambiguous');
      expect(uiFindingFor(outcome)?.reason).toBe('ambiguous-route-application');
      expect(uiFindingFor(outcome)?.hint).not.toContain('apiTarget');
    });

    it('still points at the configuration when two services answer', () => {
      const outcome = resolveUiCall(
        uiCall('web', 'GET', '/health'),
        indexOf({
          api: [route('api', 'GET', '/health')],
          legacy: [route('legacy', 'GET', '/health')],
          web: [],
        }),
      );
      expect(uiFindingFor(outcome)?.reason).toBe('ambiguous-route-target');
      expect(uiFindingFor(outcome)?.hint).toContain('apiTarget');
    });
  });

  it("finds a route of its own service behind that service's global prefix", () => {
    // The browser is handed a base address that already ends in the prefix, so
    // the path it writes is the path without it.
    const prefixed = route('web', 'GET', '/api/things');
    prefixed.meta = { ...prefixed.meta, globalPrefix: 'api' };
    const outcome = resolveUiCall(uiCall('web', 'GET', '/things'), indexOf({ web: [prefixed] }));
    expect(outcome.kind === 'linked' && outcome.via).toBe('same-service');
  });
});
