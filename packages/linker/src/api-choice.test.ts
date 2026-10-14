import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { chooseByApiName, wordsOf } from './api-choice.js';
import { findingFor, resolveCall, type RouteIndex } from './http-link.js';

const route = (api: string | undefined, path = '/status'): GraphNode => ({
  id: `entry:branch:http:GET:${path}${api === undefined ? '' : `@api:${api}`}`,
  type: 'entry',
  kind: 'http',
  label: `GET ${path}`,
  repo: 'branch',
  meta: { method: 'GET', path, ...(api === undefined ? {} : { api }) },
});

const loans = route('library-loans-api');
const events = route('library-events-api');

const call = (env: string, path = '/status'): GraphNode => ({
  id: `http_out:kiosk#board.ts:${env}`,
  type: 'http_out',
  label: `GET ${path}`,
  repo: 'kiosk',
  meta: { method: 'GET', path, baseUrlEnv: env },
});

const indexOf = (routes: GraphNode[]): RouteIndex => ({
  routesOf: (service) => (service === 'branch' ? routes : undefined),
  claimantsOf: () => ['branch'],
  markerOf: () => undefined,
});

describe('wordsOf', () => {
  it('reads every spelling and drops the words every such name has', () => {
    expect([...wordsOf('LOANS_API_URL')]).toEqual(['loans']);
    expect([...wordsOf('library-loans-api')]).toEqual(['library', 'loans']);
    expect([...wordsOf('staffLbUrl')]).toEqual(['staff']);
  });
});

describe('chooseByApiName', () => {
  it('takes the API sharing the most words with the setting', () => {
    const choice = chooseByApiName([loans, events], 'EVENTS_API_URL');
    expect(choice).toMatchObject({ kind: 'one', api: 'library-events-api', entry: events });
  });

  it('is a tie where the name settles nothing', () => {
    expect(chooseByApiName([loans, events], 'BRANCH_URL')).toEqual({ kind: 'tie', apis: ['library-events-api', 'library-loans-api'] });
    expect(chooseByApiName([loans, events], 'LIBRARY_URL')).toMatchObject({ kind: 'tie' });
  });

  it('chooses nothing among routes that are not one per API', () => {
    expect(chooseByApiName([loans, route(undefined)], 'LOANS_API_URL')).toEqual({ kind: 'none' });
    expect(chooseByApiName([loans, route('library-loans-api', '/:param')], 'LOANS_API_URL')).toEqual({ kind: 'none' });
  });
});

describe('resolveCall across two APIs at one address', () => {
  it('joins the API the setting names, as a guess, and says so', () => {
    const { outcome, notes } = resolveCall(call('LOANS_API_URL'), indexOf([loans, events]));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'apiName', entry: loans });
    expect(notes.map((note) => note.reason)).toEqual(['route-api-guessed']);
    expect(notes[0]?.level).toBe('info');
  });

  it('joins nothing and names the APIs where the setting does not say', () => {
    const { outcome } = resolveCall(call('BRANCH_URL'), indexOf([loans, events]));
    expect(outcome).toMatchObject({ kind: 'ambiguous', apis: ['library-events-api', 'library-loans-api'] });
    expect(findingFor(outcome)?.reason).toBe('ambiguous-route-api');
  });

  it('leaves a tie between routes of one API as it was', () => {
    const { outcome } = resolveCall(call('LOANS_API_URL'), indexOf([route('library-loans-api'), route(undefined)]));
    expect(findingFor(outcome)?.reason).toBe('ambiguous-route');
  });
});
