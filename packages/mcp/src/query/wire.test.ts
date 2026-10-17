import { describe, expect, it } from 'vitest';
import type { FlowNode } from './types.js';
import { slimForest, slimTree } from './wire.js';

const row = (id: string, over: Partial<FlowNode['node']> = {}, children: FlowNode[] = []): FlowNode => ({
  node: { id, type: 'method', label: id.split(':').at(-1)!, loc: 'src/a.ts:1', service: 'orders', ...over },
  edge: { type: 'calls', confidence: 'static' },
  children,
});

describe('a tree slimmed for the wire (P93)', () => {
  it('says the service on the root and again only where it changes', () => {
    const tree = row('orders:A.run', {}, [row('orders:B.run', {}, [row('billing:C.run', { service: 'billing' }, [row('billing:D.run', { service: 'billing' })])])]);
    const slim = slimTree(tree);
    expect(slim.node).toMatchObject({ service: 'orders' });
    expect(slim.children[0]!.node).not.toHaveProperty('service');
    expect(slim.children[0]!.children[0]!.node).toMatchObject({ service: 'billing' });
    expect(slim.children[0]!.children[0]!.children[0]!.node).not.toHaveProperty('service');
  });

  it('names a repeat by its id alone, and leaves out a label that is only the id', () => {
    const tree = row('orders:A.run', {}, [
      row('orders:A.run', { type: 'ref', label: 'orders:A.run', ref: true }),
      row('orders:gone', { type: 'missing', label: 'orders:gone', service: undefined }),
    ]);
    const [repeat, missing] = slimTree(tree).children;
    expect(repeat!.node).toEqual({ id: 'orders:A.run', ref: true });
    expect(repeat!.edge).toEqual({ type: 'calls', confidence: 'static' });
    expect(missing!.node).toEqual({ id: 'orders:gone', type: 'missing', loc: 'src/a.ts:1' });
  });

  it('keeps the keys of a row in the order a full one has them', () => {
    expect(Object.keys(slimTree(row('orders:A.run', { kind: 'x' })).node)).toEqual(['id', 'type', 'label', 'loc', 'service', 'kind']);
  });

  it('slims a list of callers under the service of what they call', () => {
    const [caller] = slimForest([row('orders:B.run')], 'orders');
    expect(caller!.node).not.toHaveProperty('service');
  });
});
