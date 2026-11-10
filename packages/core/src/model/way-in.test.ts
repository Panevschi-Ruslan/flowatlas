import { describe, expect, it } from 'vitest';
import type { GraphNode } from './nodes.js';
import { IMPLEMENTED_BY_META, wayInBodyRead } from './way-in.js';

const entry = (meta: Record<string, unknown> = {}): GraphNode => ({ id: 'entry:svc:rpc:grpc:grpc.health.v1.Health/Check', type: 'entry', label: 'grpc', repo: 'svc', kind: 'rpc', meta });

describe('wayInBodyRead', () => {
  it('reads a way in a package implements as having nothing of the repository behind it (P287)', () => {
    expect(wayInBodyRead(entry({ [IMPLEMENTED_BY_META]: 'grpc-health-check' }), () => false)).toBe(true);
    expect(wayInBodyRead(entry(), () => false)).toBe(false);
    expect(wayInBodyRead(entry(), () => true)).toBe(true);
  });
});
