import { describe, expect, it } from 'vitest';
import { createPageContext, createStore } from './context.js';
import { nodeAt, testPack } from './test-page.js';

/** The page's context (P103): what every panel reads, built from the packed graph alone. */
describe('the page context', () => {
  const data = testPack('context');
  const page = createPageContext(data);
  const at = nodeAt(data);

  it('reads a node by its packed fields', () => {
    const v = at('entry:gateway:http:POST:/orders');
    expect(page.nodes[v]![page.LB]).toBe('POST /orders');
    expect(page.repoName(v)).toBe('gateway');
    expect(page.typeName(v)).toBe('entry');
    expect(page.hueOf(7)).toBe('var(--s-2)');
  });

  it('lists the ways in by service, then by name', () => {
    const named = page.entryIx.map((i: number) => `${page.repoName(i)} ${page.nodes[i]![page.LB]}`);
    expect(named).toEqual([...named].sort());
    expect(named).toContain('billing event order.created');
    expect(page.entryIx.every((i: number) => ['entry', 'ui_action'].includes(page.typeName(i)))).toBe(true);
  });

  it('writes markup escaped, counts in words, and every node as a link into the graph', () => {
    expect(page.esc('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(page.plural(1, 'node', 'nodes')).toBe('1 node');
    expect(page.plural(2048, 'node', 'nodes')).toBe('2,048 nodes');
    const v = at('channel:order.created');
    expect(page.graphLink(v)).toContain(`href="#graph/${page.keys.keyOf(v)}"`);
    expect(page.opener(0, 0, 3, 'src/a.ts:3')).toBe('<span class="g-place">src/a.ts:3</span>');
  });

  it('follows only the edges a walk follows, and keeps guards aside', () => {
    const v = at('entry:gateway:http:POST:/orders');
    expect(page.guards[v].map((e: number[]) => page.nodes[e[1]!]![page.LB])).toEqual(['AuthGuard', 'RolesGuard']);
    expect(page.out[v].every((e: number[]) => page.FORWARD.has(page.edgeTypes[e[2]!]))).toBe(true);
  });

  it('starts the shared state on no way in, the Walk tab and every service', () => {
    expect(page.store.get('current')).toBeNull();
    expect(page.store.get('view')).toBe('walk');
    expect([...page.store.get('shown')]).toEqual(page.repos);
  });
});

describe('the store the tabs share', () => {
  it('tells every listener what was set, until it stops listening', () => {
    const store = createStore({ current: null, view: 'walk', shown: new Set<string>() });
    const heard: [string, unknown][] = [];
    const stop = store.on((key, value) => heard.push([key, value]));
    store.set('current', 3);
    store.set('view', 'graph');
    stop();
    store.set('current', 4);
    expect(heard).toEqual([['current', 3], ['view', 'graph']]);
    expect(store.get('current')).toBe(4);
  });

  it('says a Set changed in place when it is set again', () => {
    const shown = new Set(['a']);
    const store = createStore({ current: null, view: 'walk', shown });
    let told = 0;
    store.on((key) => { if (key === 'shown') told += 1; });
    shown.delete('a');
    store.set('shown', shown);
    expect(told).toBe(1);
    expect(store.get('shown').size).toBe(0);
  });
});
