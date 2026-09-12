import type { FlowNode } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { FORMATS } from '../options.js';
import { repoPalette, uncolored } from './color.js';
import { graphOf } from './graphify.js';
import { getRenderer } from './index.js';
import { renderJson } from './json.js';
import { renderMermaid, sanitiseIds } from './mermaid.js';
import { renderTree, truncationLine } from './tree.js';
import type { RenderOptions } from './types.js';

/**
 * One hand-built walk with every shape a renderer has to survive: a guard
 * chain, a repository boundary, an edge worth less than proof, a leaf on the
 * data layer, and a node the walk has already been through.
 */
const tree = (): FlowNode => ({
  node: {
    id: 'entry:gateway:http:POST:/orders',
    type: 'entry',
    kind: 'http',
    label: 'POST /orders',
    loc: 'src/orders/orders.controller.ts:12',
    service: 'gateway',
  },
  guards: [
    { id: 'guard:gateway#AuthGuard', label: 'AuthGuard', kind: 'guard', order: 0 },
    { id: 'guard:gateway#RolesGuard', label: 'RolesGuard', kind: 'guard', order: 1 },
  ],
  children: [
    {
      node: {
        id: 'gateway#src/orders/orders.service.ts:OrdersService.create',
        type: 'method',
        label: 'OrdersService.create',
        loc: 'src/orders/orders.service.ts:30',
        service: 'gateway',
      },
      edge: { type: 'handles', confidence: 'static' },
      children: [
        {
          node: {
            id: 'entry:orders:http:POST:/orders',
            type: 'entry',
            kind: 'http',
            label: 'POST /orders',
            loc: 'src/orders/orders.controller.ts:15',
            service: 'orders',
          },
          edge: { type: 'http_calls', confidence: 'heuristic' },
          children: [
            {
              node: {
                id: 'db_query:orders#src/orders/orders.service.ts:41:23',
                type: 'db_query',
                label: 'write Order',
                loc: 'src/orders/orders.service.ts:41',
                service: 'orders',
              },
              edge: { type: 'queries', confidence: 'marker' },
              children: [],
            },
          ],
        },
        {
          node: {
            id: 'gateway#src/orders/orders.service.ts:OrdersService.create',
            type: 'ref',
            label: 'gateway#src/orders/orders.service.ts:OrdersService.create',
            ref: true,
          },
          edge: { type: 'calls', confidence: 'runtime' },
          children: [],
        },
      ],
    },
  ],
});

const options = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  detail: 1,
  color: false,
  ascii: false,
  ...over,
});

describe('drawing a walk as a tree', () => {
  it('marks each node with the glyph for its type', () => {
    const text = renderTree(tree(), options());
    expect(text).toContain('◆');
    expect(text).toContain('→');
    expect(text).toContain('▣');
    expect(text).toContain('🛡');
  });

  it('puts the file on the right of every node that has one', () => {
    const lines = renderTree(tree(), options()).split('\n');
    const root = lines[0] as string;
    expect(root).toMatch(/POST \/orders\s+gateway\/src\/orders\/orders\.controller\.ts:12$/);
  });

  it('drops the file column entirely at level zero', () => {
    const bare: FlowNode = {
      node: { id: 'entry:gateway:http:POST:/orders', type: 'entry', label: 'POST /orders' },
      children: [],
    };
    expect(renderTree(bare, options({ detail: 0 })).trim()).toBe('◆  POST /orders');
  });

  it('lists the guards under the entry they protect, in the order they run', () => {
    const lines = renderTree(tree(), options()).split('\n');
    expect(lines[1]).toContain('AuthGuard');
    expect(lines[2]).toContain('RolesGuard');
  });

  it('still shields whatever runs before a handler, whatever the framework calls it', () => {
    const odd = tree();
    odd.guards = [{ id: 'pipe:x', label: 'ValidationPipe', kind: 'external', order: 0 }];
    expect(renderTree(odd, options()).split('\n')[1]).toContain('🛡 ValidationPipe');
  });

  it('says how much an edge is worth whenever it is worth less than proof', () => {
    const text = renderTree(tree(), options());
    expect(text).toContain('~heuristic');
    expect(text).toContain('#marker');
    expect(text).toContain('@runtime');
    // The proven edge to the handler says nothing at all.
    expect(text.split('\n')[3]).not.toMatch(/static/);
  });

  it('marks the line where the walk leaves one repository for another', () => {
    const text = renderTree(tree(), options());
    expect(text).toContain('⇢ orders');
    expect(text.match(/⇢/g)).toHaveLength(1);
  });

  it('shows a node already on the path as a repeat rather than following it', () => {
    expect(renderTree(tree(), options())).toContain('↺');
  });

  it('paints each repository its own colour and nothing when colour is off', () => {
    const palette = repoPalette(['gateway', 'orders', 'billing'], true);
    const painted = renderTree(tree(), options({ color: true, repoPalette: palette }));
    expect(painted).toMatch(/\u001B\[36m/);
    expect(painted).toMatch(/\u001B\[35m/);
    expect(uncolored(painted)).toBe(renderTree(tree(), options()));
  });

  it('leaves no escape code behind when colour is off', () => {
    expect(renderTree(tree(), options())).not.toMatch(/\u001B\[/);
  });

  it('falls back to plain prefixes when the terminal cannot draw the glyphs', () => {
    const text = renderTree(tree(), options({ ascii: true }));
    expect(text).not.toMatch(/[◆→▣🛡⇢↺]/u);
    expect(text).toContain('=> orders');
    expect(text).toContain('(cycle)');
  });

  it('says exactly how many nodes were left out', () => {
    const text = renderTree(tree(), options({ truncated: '12 more nodes, increase depth or narrow scope' }));
    expect(text).toContain('… truncated: 12 more nodes (raise --max-nodes or lower --depth)');
  });

  it('keeps the walker\'s "at least" when the count is not exact', () => {
    expect(truncationLine('≥40 more nodes, increase depth or narrow scope')).toContain('≥40 more nodes');
  });

  it('prints the types it was given, and the source, each under its own heading', () => {
    const text = renderTree(
      tree(),
      options({
        detail: 3,
        types: {
          'type:@fx/contracts#OrderDto': {
            name: 'OrderDto',
            kind: 'object',
            declaredIn: '@fx/contracts',
            structuralHash: 'bbbb2222',
            fields: [{ name: 'id', type: 'string', optional: false }],
          },
        },
        source: {
          'entry:gateway:http:POST:/orders': {
            file: 'src/orders/orders.controller.ts',
            line: 12,
            endLine: 14,
            code: 'create() {\n  return 1;\n}',
          },
        },
      }),
    );
    expect(text).toContain('--- types ---');
    expect(text).toContain('  id: string');
    expect(text).toContain('--- source ---');
    expect(text).toContain('  create() {');
  });

  it('prints whatever the command wanted said, after the tree', () => {
    expect(renderTree(tree(), options({ footer: ['unresolved on this path: 2'] }))).toContain(
      'unresolved on this path: 2',
    );
  });
});

describe('drawing a walk as a diagram', () => {
  it('rewrites ids into names the diagram language accepts', () => {
    const names = sanitiseIds([
      'entry:gateway:http:POST:/orders',
      'gateway#src/a.ts:A.b',
      'type:@fx/contracts#OrderDto',
    ]);
    for (const name of names.values()) expect(name).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('keeps two ids apart when they flatten to the same name', () => {
    const names = sanitiseIds(['a#b', 'a:b', 'a/b']);
    expect(new Set(names.values()).size).toBe(3);
  });

  it('draws one subgraph per repository and leaves channels outside them', () => {
    const withChannel: FlowNode = {
      node: { id: 'channel:order.created', type: 'channel', label: 'order.created', service: 'orders' },
      children: [],
    };
    const text = renderMermaid(withChannel, options());
    expect(text).not.toContain('subgraph');

    const drawn = renderMermaid(tree(), options());
    expect(drawn).toContain('subgraph sg_gateway["gateway"]');
    expect(drawn).toContain('subgraph sg_orders["orders"]');
  });

  it('names what every edge is, since an unlabelled arrow says less than the graph knows', () => {
    const text = renderMermaid(tree(), options());
    const arrows = text.split('\n').filter((line) => line.includes('-->'));
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) expect(arrow).toMatch(/-->\|"[a-z_]+/);
  });

  it('adds how far to trust an edge to its name, when it is not proof', () => {
    const text = renderMermaid(tree(), options());
    expect(text).toContain('~heuristic"|');
  });

  it('escapes a quote in a label rather than breaking the diagram', () => {
    const quoted: FlowNode = {
      node: { id: 'x', type: 'method', label: 'say "hello"' },
      children: [],
    };
    expect(renderMermaid(quoted, options())).toContain('#quot;hello#quot;');
  });
});

describe('drawing a walk as data', () => {
  it('says only what the level promised', () => {
    const bare: FlowNode = {
      node: { id: 'x', type: 'method', label: 'X.y' },
      children: [],
    };
    const payload = JSON.parse(renderJson(bare, options({ detail: 0 }))) as {
      root: { node: Record<string, unknown> };
    };
    expect(Object.keys(payload.root.node).sort()).toEqual(['id', 'label', 'type']);
  });

  it('carries the code of each node it was given, at the level that quotes code', () => {
    const payload = JSON.parse(
      renderJson(
        tree(),
        options({
          detail: 3,
          source: {
            'entry:gateway:http:POST:/orders': {
              file: 'a.ts',
              line: 1,
              endLine: 1,
              code: 'const a = 1;',
            },
          },
        }),
      ),
    ) as { root: { node: { code?: string } } };
    expect(payload.root.node.code).toBe('const a = 1;');
  });

  it('flattens the tree back into nodes and links, each named once', () => {
    const { nodes, links } = graphOf(tree());
    expect(nodes.map((node) => node.id)).toEqual([...nodes.map((node) => node.id)].sort());
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(links.some((link) => link.type === 'guarded_by')).toBe(true);
  });
});

describe('every format at every level', () => {
  it('renders each of the sixteen pairs without complaint', () => {
    for (const format of FORMATS) {
      for (const detail of [0, 1, 2, 3] as const) {
        const text = getRenderer(format).render(tree(), options({ detail }));
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});
