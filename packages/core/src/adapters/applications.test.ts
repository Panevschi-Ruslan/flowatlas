import { describe, expect, it } from 'vitest';
import { applicationsIn, applicationsServing } from './applications.js';

const MAP = {
  names: ['ApiModule', 'WorkerModule'],
  of: {
    'svc#src/health.controller.ts:HealthController': ['ApiModule'],
    'svc#src/status.controller.ts:StatusController': ['ApiModule', 'WorkerModule'],
  },
};

describe('applicationsIn', () => {
  it('reads the map an extractor left on the context', () => {
    expect(applicationsIn({ applications: MAP })?.names).toEqual(['ApiModule', 'WorkerModule']);
  });

  it('answers nothing where no extractor wrote one', () => {
    expect(applicationsIn(undefined)).toBeUndefined();
    expect(applicationsIn({})).toBeUndefined();
  });

  // Plain data on the context, so the shape is checked rather than assumed: the
  // adapter that reads it may not import the reader that writes it.
  it('answers nothing for a value of the wrong shape', () => {
    expect(applicationsIn({ applications: { names: 'ApiModule' } })).toBeUndefined();
    expect(applicationsIn({ applications: { names: [], of: null } })).toBeUndefined();
  });
});

describe('applicationsServing', () => {
  it('names each application that mounts the declaration', () => {
    expect(applicationsServing(MAP, 'svc#src/status.controller.ts:StatusController')).toEqual([
      'ApiModule',
      'WorkerModule',
    ]);
  });

  it('qualifies nothing where the service creates one application', () => {
    const one = { names: ['ApiModule'], of: { 'svc#a.ts:A': ['ApiModule'] } };
    expect(applicationsServing(one, 'svc#a.ts:A')).toEqual([undefined]);
  });

  it('qualifies nothing where no applications were read', () => {
    expect(applicationsServing(undefined, 'svc#a.ts:A')).toEqual([undefined]);
    expect(applicationsServing({ names: [], of: {} }, 'svc#a.ts:A')).toEqual([undefined]);
  });

  // A declaration no application mounts is one the framework never sees. Naming
  // an application for it would assert something nothing read, so it keeps the
  // plain id it had before.
  it('qualifies nothing for a declaration no application mounts', () => {
    expect(applicationsServing(MAP, 'svc#src/orphan.controller.ts:Orphan')).toEqual([undefined]);
  });

  it('never answers with an empty list, so a caller can loop over it', () => {
    expect(applicationsServing(MAP, 'nothing').length).toBeGreaterThan(0);
  });
});
