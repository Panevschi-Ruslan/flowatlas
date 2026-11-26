import { describe, expect, it } from 'vitest';
import { adapterForceOf } from './registry.js';

describe('adapterForceOf', () => {
  it('hands force on as it is while detection is on', () => {
    expect(adapterForceOf({ auto: true, force: { entry: ['nestjs-http'] } })).toEqual({ entry: ['nestjs-http'] });
    expect(adapterForceOf({ auto: true, force: {} })).toEqual({});
  });

  it('with auto off, uses only what force names: every other slot is empty, so nothing is detected', () => {
    expect(adapterForceOf({ auto: false, force: { db: ['prisma'] } })).toEqual({
      entry: [],
      db: ['prisma'],
      broker: [],
      frontend: [],
    });
    expect(adapterForceOf({ auto: false, force: {} })).toEqual({ entry: [], db: [], broker: [], frontend: [] });
  });
});
