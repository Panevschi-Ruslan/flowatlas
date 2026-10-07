import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from '../builder.js';
import { SIGNATURE_META } from '../model/types.js';
import { TypeCollector } from './collector.js';
import { functionLikeOf, recordSignatures } from './signatures.js';

const SOURCE = `
export interface Order { id: string }
export function declared(order: Order, note?: string): Order { return order; }
export const arrow = async (id: string): Promise<Order> => ({ id });
export const expressed = function (...ids: string[]): void {};
export const notAFunction = 42;
export class Widget {
  method(order: Order): void {}
  field = (count: number): number => count;
  plain = 3;
}
export const table = { handle: (order: Order): void => {} };
`;

describe('what a function takes, whichever way it was written', () => {
  let file: SourceFile;
  let builder: GraphBuilder;
  let collector: TypeCollector;

  beforeEach(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    file = project.createSourceFile('orders.ts', SOURCE);
    builder = new GraphBuilder({ repo: 'orders', generatedAt: '2026-01-01T00:00:00.000Z' });
    collector = new TypeCollector({ builder, repo: 'orders' });
  });

  const widget = () => file.getClassOrThrow('Widget');

  it('finds the function behind every spelling, and nothing behind a value', () => {
    expect(functionLikeOf(file.getFunctionOrThrow('declared'))?.getKindName()).toBe('FunctionDeclaration');
    expect(functionLikeOf(file.getVariableDeclarationOrThrow('arrow'))?.getKindName()).toBe('ArrowFunction');
    expect(functionLikeOf(file.getVariableDeclarationOrThrow('expressed'))?.getKindName()).toBe('FunctionExpression');
    expect(functionLikeOf(widget().getMethodOrThrow('method'))?.getKindName()).toBe('MethodDeclaration');
    expect(functionLikeOf(widget().getPropertyOrThrow('field'))?.getKindName()).toBe('ArrowFunction');
    const handle = file
      .getVariableDeclarationOrThrow('table')
      .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      .getPropertyOrThrow('handle');
    expect(functionLikeOf(handle)?.getKindName()).toBe('ArrowFunction');
    expect(functionLikeOf(file.getVariableDeclarationOrThrow('notAFunction'))).toBeUndefined();
    expect(functionLikeOf(widget().getPropertyOrThrow('plain'))).toBeUndefined();
  });

  it('writes the names on the node once and the bare types on every edge in', () => {
    const add = (id: string) => builder.addNode({ id, type: 'function', label: id, repo: 'orders' });
    add('declared');
    add('field');
    add('caller');
    builder.addEdge({ from: 'caller', to: 'declared', type: 'calls', confidence: 'static' });
    builder.addEdge({ from: 'caller', to: 'field', type: 'calls', confidence: 'static' });
    builder.addEdge({ from: 'caller', to: 'declared', type: 'reads_config', confidence: 'static' });

    const recorded = recordSignatures(builder, collector, [
      ['declared', file.getFunctionOrThrow('declared')],
      ['field', widget().getPropertyOrThrow('field')],
      // Never drawn, so never read.
      ['missing', file.getVariableDeclarationOrThrow('arrow')],
    ]);

    expect([...recorded.keys()]).toEqual(['declared', 'field']);
    expect(builder.getNode('declared')?.meta?.[SIGNATURE_META]).toEqual({
      params: [
        { name: 'order', type: 'type:orders#Order' },
        { name: 'note', type: 'string|undefined', optional: true },
      ],
      returns: 'type:orders#Order',
    });
    expect(builder.getNode('field')?.meta?.[SIGNATURE_META]).toEqual({
      params: [{ name: 'count', type: 'number' }],
      returns: 'number',
    });
    const into = (to: string, type = 'calls') =>
      builder.edges.find((edge) => edge.to === to && edge.type === type);
    expect(into('declared')).toMatchObject({ params: ['type:orders#Order', 'string|undefined'], returns: 'type:orders#Order' });
    expect(into('field')).toMatchObject({ params: ['number'], returns: 'number' });
    // Only the edges asked for, a call unless the reader says otherwise.
    expect(into('declared', 'reads_config')?.params).toBeUndefined();
  });

  it('writes on a way in only when the reader asks for it', () => {
    builder.addNode({ id: 'handler', type: 'function', label: 'handler', repo: 'orders' });
    builder.addNode({ id: 'route', type: 'entry', label: 'route', repo: 'orders' });
    builder.addEdge({ from: 'route', to: 'handler', type: 'handles', confidence: 'static' });
    const handled = () => builder.edges.find((edge) => edge.type === 'handles');

    recordSignatures(builder, collector, [['handler', file.getFunctionOrThrow('declared')]]);
    expect(handled()?.returns).toBeUndefined();
    expect(builder.getNode('handler')?.meta?.[SIGNATURE_META]).toBeDefined();

    recordSignatures(builder, collector, [['handler', file.getFunctionOrThrow('declared')]], ['handles']);
    expect(handled()?.returns).toBe('type:orders#Order');
  });

  it('keeps the first recording of an id', () => {
    builder.addNode({ id: 'one', type: 'function', label: 'one', repo: 'orders' });
    recordSignatures(builder, collector, [
      ['one', file.getVariableDeclarationOrThrow('expressed')],
      ['one', file.getFunctionOrThrow('declared')],
    ]);
    expect(builder.getNode('one')?.meta?.[SIGNATURE_META]).toEqual({
      params: [{ name: 'ids', type: 'string[]', rest: true }],
      returns: 'void',
    });
  });
});
