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

  it('narrows to the API named where it has a route per listener (P61)', () => {
    const plain = { ...route('library-staff-lb', '/health'), id: 'entry:branch:http:GET:/health@api:library-staff-lb@listener:HTTP:80' };
    const secure = { ...route('library-staff-lb', '/health'), id: 'entry:branch:http:GET:/health@api:library-staff-lb@listener:HTTPS:443' };
    const choice = chooseByApiName([plain, secure, route('library-public-lb', '/health')], 'STAFF_LB_URL');
    expect(choice).toEqual({ kind: 'narrowed', entries: [plain, secure], api: 'library-staff-lb' });
  });

  it('reads an API by its address where its name is not read (P61)', () => {
    const desk = route(undefined, '/hours');
    const lab = route(undefined, '/hours');
    const at = (node: GraphNode, address: string): GraphNode => ({ ...node, id: `${node.id}@api:${address}`, meta: { ...node.meta, apiAddress: address } });
    const choice = chooseByApiName([at(desk, 'aws_apigatewayv2_api.desk_hours'), at(lab, 'aws_apigatewayv2_api.lab_hours')], 'LAB_HOURS_URL');
    expect(choice).toMatchObject({ kind: 'one', api: 'aws_apigatewayv2_api.lab_hours' });
  });
});

describe('an annotation naming an address two APIs serve (P61)', () => {
  const marked = (env?: string): GraphNode => ({
    id: 'http_out:kiosk#hours.ts:deskHours',
    type: 'http_out',
    label: 'GET ?',
    repo: 'kiosk',
    meta: { method: 'GET', path: null, ...(env === undefined ? {} : { baseUrlEnv: env }) },
  });
  const withMarker = (routes: GraphNode[]): RouteIndex => ({
    ...indexOf(routes),
    markerOf: () => ({ service: 'branch', method: 'GET', path: '/status' }),
  });

  it('joins the API the setting names, as a guess', () => {
    const { outcome, notes } = resolveCall(marked('EVENTS_API_URL'), withMarker([loans, events]));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'apiName', entry: events });
    expect(notes.map((note) => note.reason)).toEqual(['route-api-guessed']);
  });

  it('names the APIs where neither the setting nor the service settles it', () => {
    const { notes } = resolveCall(marked(), withMarker([loans, events]));
    expect(notes.map((note) => note.reason)).toEqual(['ambiguous-route-api']);
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
