import { describe, expect, it } from 'vitest';
import { joinPath } from './shared.js';

describe('joinPath', () => {
  it('joins a prefix, a controller path and a route path', () => {
    expect(joinPath('api', 'orders', ':id')).toBe('/api/orders/:id');
  });

  it('drops empty segments', () => {
    expect(joinPath(undefined, 'orders', '')).toBe('/orders');
    expect(joinPath('', '', '')).toBe('/');
  });

  it('collapses slashes wherever they came from', () => {
    expect(joinPath('/api/', '/orders/', '/:id')).toBe('/api/orders/:id');
  });

  it('keeps a wildcard', () => {
    expect(joinPath('api', 'files', '*')).toBe('/api/files/*');
  });

  it('returns the root when there is nothing to join', () => {
    expect(joinPath()).toBe('/');
    expect(joinPath(undefined, undefined)).toBe('/');
  });
});
