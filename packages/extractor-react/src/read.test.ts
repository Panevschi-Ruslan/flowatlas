import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  wasRead,
  type ExtractContext,
  type EntryAdapter,
  type EntryNode,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory, exactly as the adapter would. */
const read = (
  files: Record<string, string>,
  service?: Partial<ServiceConfig>,
  entry: EntryAdapter[] = [],
): RepoGraph => {
  const project = new Project({
    useInMemoryFileSystem: true,
    // `4` is the setting that parses markup as markup; without it every
    // component in the repository is a syntax error and none of them is read.
    compilerOptions: { strict: false, jsx: 4 },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react', ...service },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: { ...noAdapters, entry },
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

const requests = (graph: RepoGraph): GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'ui_api_call');

const edge = (graph: RepoGraph, from: string, to: string): GraphEdge | undefined =>
  graph.edges.find((each) => each.from === from && each.to === to);

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason);

describe('what a function is', () => {
  it('is a component when the name is capitalised and markup comes back', () => {
    const graph = read({
      '/src/Panel.tsx': `
        export function Panel() { return <div />; }
        export function Total() { return '12'; }
        export const useOrders = () => ({ refresh: () => undefined });
      `,
      '/src/uses.tsx': `
        import { Panel, Total, useOrders } from './Panel';
        export function Screen() { useOrders(); return <div>{Total()}<Panel /></div>; }
      `,
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get('web#src/Panel.tsx:Panel')?.type).toBe('ui_component');
    // Capitalised and returns a string: a helper, and calling it a screen would
    // put a screen on the end of every `impact` that reached it.
    expect(byId.get('web#src/Panel.tsx:Total')?.type).toBe('function');
    expect(byId.get('web#src/Panel.tsx:useOrders')?.kind).toBe('hook');
  });
});

describe('requests a React repository makes', () => {
  it('reads the address, the verb and the settings key it is rooted at', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        export const listOrders = () => fetch(\`\${base}/api/orders\`);
        export const patchOrder = (id: string) =>
          fetch(\`\${base}/api/orders/\${id}\`, { method: 'PATCH' });
      `,
    });
    expect(requests(graph).map((node) => node.label).sort()).toEqual([
      'GET /api/orders',
      'PATCH /api/orders/:param',
    ]);
    expect(requests(graph)[0]?.meta?.['baseUrlEnv']).toBe('VITE_API_URL');
  });

  it('reads the other two spellings of the settings a build swaps out', () => {
    const graph = read({
      '/src/a.ts': `
        export const one = () => fetch(\`\${process.env.NEXT_PUBLIC_API}/api/one\`);
      `,
      '/src/b.ts': `
        import { environment } from './environment';
        export const two = () => fetch(\`\${environment.apiUrl}/api/two\`);
      `,
      '/src/environment.ts': `export const environment = { apiUrl: 'http://localhost' };`,
    });
    const keys = requests(graph)
      .map((node) => node.meta?.['baseUrlEnv'])
      .sort();
    expect(keys).toEqual(['NEXT_PUBLIC_API', 'apiUrl']);
  });

  // The protocol has a default and the call that writes no options really is a
  // `GET`. A call handed an options object assembled elsewhere could be
  // anything, and saying `GET` about that would be an invention.
  it('tells the verb it knows from the verb it could not read', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        export const plain = () => fetch(\`\${base}/api/one\`);
        export const opaque = (init: RequestInit) => fetch(\`\${base}/api/two\`, init);
      `,
    });
    const byPath = new Map(requests(graph).map((node) => [node.meta?.['path'], node]));
    expect(byPath.get('/api/one')?.meta?.['method']).toBe('GET');
    expect(byPath.get('/api/two')?.meta?.['method']).toBeNull();
    expect(reasons(graph)).toContain('api-method-dynamic');
  });

  it('refuses a name the repository declared itself', () => {
    const graph = read({
      '/src/api.ts': `
        const fetch = (url: string) => url;
        export const listOrders = () => fetch('/api/orders');
      `,
    });
    expect(requests(graph)).toHaveLength(0);
  });

  // The browser's own client takes a string, so what is written is always
  // `JSON.stringify(x)` and the shape worth recording is `x` rather than
  // `string`. The keys are only known where the object itself is written.
  it('records the shape a body puts on the wire, through the serialiser', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        export const save = (order: { id: string }) =>
          fetch(\`\${base}/api/orders\`, { method: 'POST', body: JSON.stringify(order) });
        export const touch = () =>
          fetch(\`\${base}/api/touch\`, { method: 'POST', body: JSON.stringify({ at: 1 }) });
      `,
    });
    const byPath = new Map(requests(graph).map((node) => [node.meta?.['path'], node]));
    expect(byPath.get('/api/orders')?.meta?.['bodyType']).not.toBeNull();
    expect(byPath.get('/api/orders')?.meta?.['bodyKeys']).toBeUndefined();
    expect(byPath.get('/api/touch')?.meta?.['bodyKeys']).toEqual(['at']);
  });
});

describe('what a request belongs to', () => {
  // The whole of the difference from the other front end: three files, no
  // class, no container, and the walk back to the screen is plain calls.
  it('joins the button, the hook and the API module into one chain', () => {
    const graph = read({
      '/src/api/orders.ts': `
        const base = import.meta.env.VITE_API_URL;
        export const listOrders = () => fetch(\`\${base}/api/orders\`);
      `,
      '/src/hooks/use-orders.ts': `
        import { listOrders } from '../api/orders';
        export const useOrders = () => ({ refresh: () => listOrders() });
      `,
      '/src/Panel.tsx': `
        import { useOrders } from './hooks/use-orders';
        export function Panel() {
          const orders = useOrders();
          return <button onClick={() => orders.refresh()}>Refresh</button>;
        }
      `,
    });
    expect(edge(graph, 'web#src/Panel.tsx:Panel', 'web#src/hooks/use-orders.ts:useOrders')).toBeDefined();
    expect(
      edge(graph, 'web#src/hooks/use-orders.ts:useOrders', 'web#src/api/orders.ts:listOrders'),
    ).toBeDefined();
    const [request] = requests(graph);
    expect(edge(graph, 'web#src/api/orders.ts:listOrders', request?.id ?? '')).toBeDefined();

    const action = graph.nodes.find((node) => node.type === 'ui_action');
    expect(action?.meta?.['component']).toBe('web#src/Panel.tsx:Panel');
    expect(edge(graph, action?.id ?? '', 'web#src/Panel.tsx:Panel')).toBeDefined();
  });

  it('reads a wrapper at the caller that decided the address', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        const send = (path: string) => fetch(\`\${base}\${path}\`);
        export const listInvoices = () => send('/api/invoices');
      `,
    });
    const [request] = requests(graph);
    expect(request?.meta?.['path']).toBe('/api/invoices');
    expect(request?.meta?.['through']).toBe('send');
    // Attributed to the caller, which is what makes it reachable from a screen.
    expect(edge(graph, 'web#src/api.ts:listInvoices', request?.id ?? '')).toBeDefined();
  });

  // Two wrappers deep, because a repository that has one usually has two, and a
  // reader that binds only one frame reads the second as unread.
  it('follows the address out through two wrappers', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        const send = (path: string) => fetch(\`\${base}\${path}\`);
        const underApi = (path: string) => send(\`/api\${path}\`);
        export const listInvoices = () => underApi('/invoices');
      `,
    });
    expect(requests(graph)[0]?.meta?.['path']).toBe('/api/invoices');
  });

  // The walk outward stops as soon as the address reads, and a hole between
  // two separators reads as a parameter. `/api/:param` is a fair reading of
  // this and the one a route is matched on, so going further for a better one
  // would be the reader preferring a guess to an answer it already has.
  it('stops at a hole that reads as a segment, rather than chasing the value', () => {
    const graph = read({
      '/src/api.ts': `
        const base = import.meta.env.VITE_API_URL;
        const send = (path: string) => fetch(\`\${base}\${path}\`);
        const under = (tail: string) => send(\`/api/\${tail}\`);
        export const listInvoices = () => under('invoices');
      `,
    });
    expect(requests(graph)[0]?.meta?.['path']).toBe('/api/:param');
  });

  // The acceptance this reader is most easily wrong about: a silence here reads
  // as "the front end asks for nothing", which is the opposite of the truth.
  it('says so when only the caller of the caller could know the address', () => {
    const graph = read({
      '/src/hooks/use-resource.ts': `
        const base = import.meta.env.VITE_API_URL;
        export const useResource = (path: string) => ({
          load: () => fetch(\`\${base}\${path}\`),
        });
      `,
      '/src/Panel.tsx': `
        import { useResource } from './hooks/use-resource';
        export function Panel(props: { path: string }) {
          const resource = useResource(props.path);
          return <button onClick={() => resource.load()}>Load</button>;
        }
      `,
    });
    const [request] = requests(graph);
    expect(request).toBeDefined();
    expect(wasRead(String(request?.meta?.['path']))).toBe(false);
  });

  it('reports an address that is nothing but a parameter', () => {
    const graph = read({
      '/src/api.ts': `
        export const load = (url: string) => fetch(url);
      `,
    });
    expect(requests(graph)[0]?.meta?.['path']).toBeNull();
    expect(reasons(graph)).toContain('api-path-dynamic');
  });
});

describe('what a screen is', () => {
  it('takes the address from a route table', () => {
    const graph = read({
      '/src/Panel.tsx': `export function Panel() { return <div />; }`,
      '/src/routes.tsx': `
        import { Panel } from './Panel';
        export const routes = [{ path: '/orders', element: <Panel /> }];
      `,
    });
    const panel = graph.nodes.find((node) => node.id === 'web#src/Panel.tsx:Panel');
    expect(panel?.meta?.['route']).toBe('/orders');
  });

  it('takes the address from a route element', () => {
    const graph = read({
      '/src/Panel.tsx': `export function Panel() { return <div />; }`,
      '/src/routes.tsx': `
        import { Panel } from './Panel';
        export function Routes() {
          return <Route path="/orders/:id" element={<Panel />} />;
        }
      `,
    });
    const panel = graph.nodes.find((node) => node.id === 'web#src/Panel.tsx:Panel');
    expect(panel?.meta?.['route']).toBe('/orders/:param');
  });

  it('takes the address from where the file is, for the default export alone', () => {
    const graph = read({
      '/app/orders/page.tsx': `
        export function Row() { return <li />; }
        export default function OrdersPage() { return <ul><Row /></ul>; }
      `,
    });
    const page = graph.nodes.find((node) => node.id === 'web#app/orders/page.tsx:OrdersPage');
    const row = graph.nodes.find((node) => node.id === 'web#app/orders/page.tsx:Row');
    expect(page?.meta?.['route']).toBe('/orders');
    expect(row?.meta?.['route']).toBeUndefined();
  });
});

/**
 * The source both tests below are read from: one boundary declared outright and
 * one built by a library, with a screen that crosses each of them once.
 */
const ACTIONS = {
  '/lib/orders-store.ts': `
    export const archive = async (id: string): Promise<void> => { void id; };
  `,
  '/app/actions/orders.ts': `
    import { archive } from '../../lib/orders-store';
    export async function cancelOrder(id: string) {
      await archive(id);
      return { cancelled: true };
    }
    export const archiveOrder = actionClient
      .schema({ id: 'string' })
      .action(async (input: { id: string }) => {
        await archive(input.id);
        return { archived: true };
      });
  `,
  '/app/orders/page.tsx': `
    import { archiveOrder, cancelOrder } from '../actions/orders';
    export default function OrdersPage(props: { id: string }) {
      const onArchive = () => archiveOrder({ id: props.id });
      const onCancel = () => cancelOrder(props.id);
      return <main><button onClick={onArchive} /><button onClick={onCancel} /></main>;
    }
  `,
};

/**
 * An entry adapter that reports what a server-action reader reports.
 *
 * Written here rather than imported, because what is under test is the half of
 * the contract this extractor answers: an entry reached by import, whose code
 * is named in one case and written in the registration in the other. The
 * positions are asked of the source for the same reason the real adapter asks
 * for them — the line a function starts on is the only name an inline one has.
 */
const actionBoundaries: EntryAdapter = {
  name: 'actions',
  detect: () => true,
  extractEntries: (ctx) => {
    const file = 'app/actions/orders.ts';
    const sourceFile = ctx.project.getSourceFileOrThrow(`/${file}`);
    const built = sourceFile.getVariableDeclarationOrThrow('archiveOrder');
    const written = built.getFirstDescendantByKindOrThrow(SyntaxKind.ArrowFunction);
    const at = sourceFile.getLineAndColumnAtPos(written.getStart());
    const declared = sourceFile.getFunctionOrThrow('cancelOrder');
    const entries: EntryNode[] = [
      {
        id: 'entry:web:rpc:archiveOrder',
        kind: 'rpc',
        label: 'action archiveOrder',
        key: 'action:archiveOrder',
        handler: {
          file,
          line: at.line,
          column: at.column,
          label: 'action archiveOrder',
          inline: true,
        },
        file,
        line: built.getStartLineNumber(),
        meta: { viaImport: true },
      },
      {
        id: 'entry:web:rpc:cancelOrder',
        kind: 'rpc',
        label: 'action cancelOrder',
        key: 'action:cancelOrder',
        handler: { file, functionName: 'cancelOrder' },
        file,
        line: declared.getStartLineNumber(),
        meta: { viaImport: true },
      },
    ];
    return entries;
  },
};

describe('a boundary that is reached by importing it', () => {
  it('draws the caller of a built action, as it already did for a declared one', () => {
    const graph = read(ACTIONS, undefined, [actionBoundaries]);
    const page = 'web#app/orders/page.tsx:OrdersPage';
    expect(edge(graph, page, 'entry:web:rpc:cancelOrder')).toBeDefined();
    // The defect this covers: the caller writes `archiveOrder`, which is the
    // export, and the code behind the boundary is an arrow with no name.
    expect(edge(graph, page, 'entry:web:rpc:archiveOrder')).toBeDefined();
    // The export is a function of this repository in its own right, so what it
    // reaches is on the graph under the name every caller writes.
    expect(
      edge(graph, 'web#app/actions/orders.ts:archiveOrder', 'web#lib/orders-store.ts:archive'),
    ).toBeDefined();
  });

  it('points a boundary at the function written in the registration itself', () => {
    const graph = read(ACTIONS, undefined, [actionBoundaries]);
    const handles = graph.edges.filter(
      (each) => each.type === 'handles' && each.from === 'entry:web:rpc:archiveOrder',
    );
    expect(handles).toHaveLength(1);
    const written = graph.nodes.find((node) => node.id === handles[0]?.to);
    expect(written?.label).toMatch(/^action archiveOrder@\d+$/);
  });
});
