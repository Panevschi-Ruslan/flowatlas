import { describe, expect, it } from 'vitest';
import { nitroAddressOf } from './nuxt-routes.js';

describe("Nitro's routes, by the names of their files (P233)", () => {
  it('reads the verb from the name, and every verb from a name with none', () => {
    expect(nitroAddressOf('server/api/orders.get.ts')).toMatchObject({ method: 'GET', path: '/api/orders' });
    expect(nitroAddressOf('server/api/orders/[id].delete.ts')).toMatchObject({ method: 'DELETE', path: '/api/orders/:param', rawPath: '/api/orders/:id' });
    expect(nitroAddressOf('server/routes/health.ts')).toMatchObject({ method: 'ALL', path: '/health' });
    expect(nitroAddressOf('server/api/index.post.ts')).toMatchObject({ method: 'POST', path: '/api' });
  });

  it('drops a group folder, and reads the rest of the path as one parameter', () => {
    expect(nitroAddressOf('server/api/(admin)/users.ts')?.path).toBe('/api/users');
    expect(nitroAddressOf('server/api/files/[...path].get.ts')).toMatchObject({ method: 'GET' });
  });

  it('serves nothing from a file outside the two folders', () => {
    expect(nitroAddressOf('server/utils/orders.ts')).toBeNull();
    expect(nitroAddressOf('server/middleware/auth.ts')).toBeNull();
    expect(nitroAddressOf('pages/index.ts')).toBeNull();
  });
});
