import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEvent, installDocument, textOf } from '../visualise/panels/test-dom.js';
import { runObserve } from './observe.js';
import { inlined, PAGE_PARTS, runVisualise, template, writeParts } from './visualise.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-visualise-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

let page: string;
let out: string;

const VISUALISE = resolve(import.meta.dirname, '..', 'visualise');
/** A part as it sits in the source, before the page drops a panel's imports. */
const sourceOf = (file: string): string =>
  readFileSync(file === 'prompt-text.js' ? resolve(ROOT, 'packages/core/src/prompt-text.js') : join(VISUALISE, file), 'utf8');

const dataOf = (html: string): Record<string, any> => {
  const opening = '<script type="application/json" id="graph">';
  const start = html.indexOf(opening) + opening.length;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start)));
};

beforeAll(() => {
  out = join(scratch, 'graph.html');
  runVisualise({ config: CONFIG, out, print: () => {} });
  page = readFileSync(out, 'utf8');
});

describe('the page made of its parts (P103)', () => {
  /** The page's one module script, as written. */
  const scriptOf = (html: string): string => {
    const opening = '<script type="module">';
    const start = html.indexOf(opening) + opening.length;
    return html.slice(start, html.indexOf('</script>', start));
  };

  it('holds its markup and placeholders only, under 400 lines', () => {
    const html = readFileSync(join(VISUALISE, 'page.html'), 'utf8');
    expect(html.split('\n').length).toBeLessThan(400);
    for (const [placeholder] of PAGE_PARTS) expect(html.split(placeholder)).toHaveLength(2);
  });

  it('writes every part in, as one style, one graph and one module script, with no placeholder left', () => {
    expect(page.match(/<style>/g)).toHaveLength(1);
    expect(page.match(/<script type="application\/json" id="graph">/g)).toHaveLength(1);
    expect(page.match(/<script type="module">/g)).toHaveLength(1);
    expect(page.match(/<script/g)).toHaveLength(2);
    expect(page).not.toMatch(/__[A-Z][A-Z_]*__/);
    for (const [, file] of PAGE_PARTS) expect(page, file).toContain(inlined(file, sourceOf(file)).trim());
  });

  it('drops a panel’s imports, since the page already holds every name they bring', () => {
    const script = scriptOf(page);
    expect(script).not.toMatch(/^import\b/m);
    expect(inlined('panels/x.js', "import { a,\n  b } from '../graph.js';\nexport function x() {}\n")).toBe('export function x() {}\n');
    expect(() => inlined('panels/x.js', "import { a as b } from '../graph.js';\n")).toThrow(/under another/);
    expect(() => inlined('panels/x.js', "import * as all from '../graph.js';\n")).toThrow(/cannot drop/);
    expect(inlined('graph.js', "import { a } from 'b';\n")).toBe("import { a } from 'b';\n");
  });

  it('refuses a page with no place for a part, or a place with no part', () => {
    const html = PAGE_PARTS.map(([placeholder]) => placeholder).join('\n');
    const read = (): string => 'part';
    expect(writeParts(html, read)).toBe(PAGE_PARTS.map(() => 'part').join('\n'));
    expect(() => writeParts(html.replace('__BAND_LOGIC__', ''), read)).toThrow(/no place for its panels\/band\.js/);
    expect(() => writeParts(html + '\n__LOST_LOGIC__', read)).toThrow(/__LOST_LOGIC__ has no part/);
    expect(writeParts(html + '\n__TITLE__ __DATA__', read)).toContain('__TITLE__ __DATA__');
    expect(writeParts(html, () => '$& $1')).toContain('$& $1');
  });

  it('never has two parts declare one name in the script they share', () => {
    const owner = new Map<string, string>();
    const twice: string[] = [];
    for (const [, file] of PAGE_PARTS.filter(([, name]) => name.endsWith('.js'))) {
      const text = inlined(file, sourceOf(file));
      for (const [, name] of text.matchAll(/^(?:export )?(?:const|let|var|class|function\*?|async function) ([A-Za-z_$][\w$]*)/gm)) {
        if (owner.has(name!)) twice.push(`${name} in ${owner.get(name!)} and ${file}`);
        owner.set(name!, file);
      }
    }
    expect(twice).toEqual([]);
  });

  it.skipIf(!existsSync(resolve(import.meta.dirname, '..', '..', 'dist', 'index.js')))(
    'ships every part beside the built command',
    () => {
      const dist = resolve(import.meta.dirname, '..', '..', 'dist', 'visualise');
      for (const [, file] of PAGE_PARTS) expect(existsSync(join(dist, file)), file).toBe(true);
      expect(existsSync(join(dist, 'page.html'))).toBe(true);
    },
  );

  it('runs, as written, in a document: the band, the ways in and the first view drawn', async () => {
    const markup = page.slice(page.indexOf('<div class="shell">'), page.indexOf('<script type="module">'));
    const window = installDocument(markup);
    const file = join(scratch, 'page-boot.mjs');
    writeFileSync(file, scriptOf(page));
    await import(pathToFileURL(file).href);
    const doc = window.document;
    expect(doc.querySelectorAll('#band .pill dt').map(textOf)[0]).toBe('Read');
    const rows = doc.querySelectorAll('#entries button.row').length;
    expect(rows).toBeGreaterThan(0);
    // Every way in is listed; the list draws only the rows in sight (P102), so no more than that many.
    const [listed, all] = textOf(doc.getElementById('entry-count')).split(' of ').map(Number);
    expect(listed).toBe(all);
    expect(rows).toBeLessThanOrEqual(all!);
    expect(doc.getElementById('map-view')!.hidden).toBe(false);
    expect(doc.querySelectorAll('#m-world .m-unit').length).toBeGreaterThan(0);
    // Read from code; the run-time sentence only where a trace was imported (P101).
    expect(textOf(doc.getElementById('colophon'))).toMatch(/^Read from the source code\. A path shown as/);
    // From the keyboard only (P101): `/`, a word, Enter lands somewhere marked; ⌘K and ? open.
    doc.body.dispatchEvent(new FakeEvent('keydown', { key: '/' }));
    const find = doc.getElementById('find')!;
    expect(doc.activeElement).toBe(find);
    find.value = 'orders';
    find.dispatchEvent(new FakeEvent('input'));
    find.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    expect(doc.querySelectorAll('.is-found').length).toBeGreaterThan(0);
    doc.body.dispatchEvent(new FakeEvent('keydown', { key: 'k', metaKey: true }));
    expect(doc.getElementById('palette')!.hidden).toBe(false);
    doc.getElementById('palette-input')!.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    doc.body.dispatchEvent(new FakeEvent('keydown', { key: '?' }));
    expect(doc.getElementById('keys-help')!.hidden).toBe(false);
    // One Steps tab, three ways to draw it (P99): the first way in leaves a service, so a crossing row shows.
    expect(doc.querySelector('.tab[data-view="walk"]')).toBeNull();
    doc.querySelector('.tab[data-view="steps"]')!.click();
    for (const mode of ['compact', 'detailed', 'waterfall']) {
      doc.querySelector(`[data-step-mode="${mode}"]`)!.click();
      expect(doc.querySelectorAll(mode === 'waterfall' ? '#s-list .w-row' : '#s-list .s-row').length, mode).toBeGreaterThan(1);
      if (mode !== 'waterfall') expect(doc.querySelectorAll('#s-list .s-cross').length, mode).toBeGreaterThan(0);
    }
    expect(template()).toBe(template());
  });

  /* The fixture with its traces observed, so the panels have what traffic
     answered (P106) beside the docs `flowatlas docs` tied to the flows (P120). */
  const observedPage = (): string => {
    const copy = join(scratch, 'observed');
    cpSync(join(ROOT, 'fixtures', 'multi-repo', '.flowatlas'), copy, { recursive: true });
    const traces = ['checkout.otlp.json', 'billing.observe.json', 'billing.batches.observe.json']
      .map((file) => join(ROOT, 'fixtures', 'multi-repo', 'traces', file));
    runObserve(traces, { config: CONFIG, db: join(copy, 'graph.db'), now: new Date('2025-10-16T09:00:00.000Z'), print: () => {} });
    const file = join(copy, 'graph.html');
    runVisualise({ config: CONFIG, db: join(copy, 'graph.db'), out: file, print: () => {} });
    return readFileSync(file, 'utf8');
  };
  const bootAt = async (html: string, address: string, name: string) => {
    const markup = html.slice(html.indexOf('<div class="shell">'), html.indexOf('<script type="module">'));
    const window = installDocument(markup, 'file:///project/graph.html' + address);
    const file = join(scratch, `${name}.mjs`);
    writeFileSync(file, scriptOf(html));
    await import(pathToFileURL(file).href);
    return window.document;
  };

  it('says beside each failure what traffic answered, and which docs describe a node, in the panels (P106, P120)', async () => {
    const html = observedPage();
    const data = dataOf(html);
    const at = (id: string): number => data.entryIds[id];
    // A way in that declares 409 no request answered, and answered a 500 nothing declares.
    const doc = await bootAt(html, `#graph/${at('entry:billing:http:POST:/invoices')}`, 'page-observed-billing');
    const details = doc.getElementById('g-details')!;
    expect(details.hidden).toBe(false);
    const chips = details.querySelectorAll('.fail-chips .fail-chip').map((chip) => [textOf(chip), chip.getAttribute('class')]);
    expect(chips).toContainEqual(['409 never seen', 'fail-chip is-never']);
    expect(chips).toContainEqual(['500 ×1 not declared', 'fail-chip is-undeclared']);
    expect(textOf(details)).toContain('Run time: 22 hits, 2025-10-16T07:00:00.000Z to 2025-10-16T09:00:00.000Z.');
    // The same chips on the Steps header of that way in.
    details.querySelector('[data-act="open-steps"]')!.click();
    expect(doc.querySelectorAll('#steps-view .s-head .fail-chip').map(textOf)).toContain('409 never seen');
    // A declared status traffic answered, and the docs that describe a way in.
    const orders = await bootAt(html, `#graph/${at('entry:billing:http:GET:/invoices/:param')}`, 'page-observed-invoice');
    expect(orders.querySelectorAll('#g-details .fail-chip.is-seen').map(textOf)).toContain('404 seen ×1');
    const described = await bootAt(html, `#graph/${at('entry:orders:http:POST:/orders')}`, 'page-observed-orders');
    const panel = described.getElementById('g-details')!;
    expect(panel.querySelectorAll('section h4').map(textOf)).toContain('Described in · 2');
    expect(panel.querySelectorAll('.doc-list .tag').map(textOf)).toEqual(['up to date', 'stale: the flow changed']);
    // The way in picked is drawn on the Ways in list with what traffic answered beside its failures.
    const row = described.querySelector(`#entries button.row[data-entry="${at('entry:orders:http:POST:/orders')}"]`)!;
    expect(row.querySelectorAll('.fail-chip').map(textOf)).toContain('500 ×1 not declared');
  });

  /* The fixture with all four trace files observed, and a second file a day
     later with the page loads slower and failing (P111): what Steps, the Map,
     Traces and Run time changes draw. */
  const runTimePage = (): string => {
    const traces = (files: string[]) => files.map((file) => join(ROOT, 'fixtures', 'multi-repo', 'traces', file));
    const observeInto = (name: string, files: string[]): string => {
      const copy = join(scratch, name);
      cpSync(join(ROOT, 'fixtures', 'multi-repo', '.flowatlas'), copy, { recursive: true });
      runObserve(files, { config: CONFIG, db: join(copy, 'graph.db'), now: new Date('2025-10-16T09:00:00.000Z'), print: () => {} });
      return copy;
    };
    const before = observeInto('runtime-before', traces(['checkout.otlp.json', 'billing.observe.json', 'billing.batches.observe.json', 'web.otlp.json']));
    const after = observeInto('runtime-after', traces(['billing.observe.json', 'billing.batches.observe.json', 'diff/web.slower.otlp.json']));
    const file = join(before, 'graph.html');
    runVisualise({
      config: CONFIG, db: join(before, 'graph.db'), out: file, print: () => {},
      observedDiff: [join(before, 'observed.json'), join(after, 'observed.json')],
    });
    return readFileSync(file, 'utf8');
  };

  it('draws run time from the fixture’s traces: the slow hop first everywhere (P111)', async () => {
    const html = runTimePage();
    const data = dataOf(html);
    const gateway = data.entryIds['entry:gateway:http:GET:/orders/:param'];
    // Traces: the slowest request is the one through the slow hop, drawn on its own axis.
    const traced = await bootAt(html, '#traces', 'page-runtime-traces');
    expect(traced.getElementById('tab-traces')!.hidden).toBe(false);
    expect(textOf(traced.querySelector('#tab-sheet [data-trace-pick]'))).toBe('GET /orders/:paramgateway · 520 ms · 200 · slowest');
    const spans = traced.querySelectorAll('#tab-sheet .tr-row').map((row) => textOf(row.querySelector('.tr-ms')));
    expect(spans.slice(0, 3)).toEqual(['520 ms · 200', '500 ms · 200', '496 ms · 200']);
    // Steps: a waterfall in typical time, the hop the widest step under the way in.
    const steps = await bootAt(html, `#graph/${gateway}`, 'page-runtime-steps');
    steps.querySelector('#g-details [data-act="open-steps"]')!.click();
    steps.querySelector('[data-step-mode="waterfall"]')!.click();
    expect(textOf(steps.querySelector('#s-list .w-axis-say'))).toBe('typical time per step (p50), not one request');
    const bars = steps.querySelectorAll('#s-list .w-row').map((row) => textOf(row.querySelector('.s-label')));
    expect(bars.length).toBeGreaterThan(2);
    // Map: by p95, the hottest link is the one into orders.
    const map = await bootAt(html, '#map/x=p95', 'page-runtime-map');
    const hottest = map.querySelectorAll('#m-world .m-link[data-heat="4"]');
    expect(hottest.length).toBeGreaterThan(0);
    expect(textOf(map.getElementById('m-heat-key'))).toContain('500 ms');
    expect(textOf(map.getElementById('built'))).toContain('seen 2025-10-16 07:00 to 09:00 UTC');
    // Run time changes: the page loads got slower and fail now and then; the checkout went quiet.
    const changes = await bootAt(html, '#runtime', 'page-runtime-changes');
    const heads = changes.querySelectorAll('#tab-sheet h4').map(textOf);
    expect(heads).toEqual(['Slower · 2', 'Failing more · 2', 'Newly seen · 0', 'No longer seen · 6']);
    expect(textOf(changes.querySelector('#tab-sheet .rt-table tbody tr'))).toContain('79 ms → 198 ms +150%');
    // Nothing in the page can be joined back to a request.
    expect(html).not.toMatch(/"traceId"|a1000000000000000000000000000001/);
  });
});

describe('writing the graph as a page', () => {
  it('is one file with nothing to fetch', () => {
    expect(page).toContain('<script type="application/json" id="graph">');
    expect(page).not.toContain('fetch(');
    expect(page).not.toMatch(/<script[^>]+src=/);
  });

  it('declares its encoding, so labels survive a server that sends no charset', () => {
    const head = page.slice(0, 200).toLowerCase();
    expect(head.startsWith('<!doctype html>')).toBe(true);
    expect(head).toContain('<meta charset="utf-8">');
  });

  it('says what language it is written in, for a screen reader (P102)', () => {
    expect(page.startsWith('<!doctype html>\n<html lang="en">\n')).toBe(true);
  });

  it('carries the whole graph, not a sample of it', () => {
    const data = dataOf(page);
    expect(data.nodes.length).toBeGreaterThan(50);
    expect(data.edges.length).toBeGreaterThan(50);
    expect(Object.keys(data.entryIds).length).toBeGreaterThan(0);
  });

  it('ships the busiest methods, and no Changes tab unless --diff asked for one', () => {
    const data = dataOf(page);
    expect(data.busiest.rows.length).toBeGreaterThan(0);
    expect(data.changes).toBeUndefined();
    expect(page).toContain('id="tab-changes" hidden');
  });

  it('carries what --diff found when it is given', () => {
    const changed = join(scratch, 'changed.html');
    const changes = {
      base: 'main', head: null, routes: { added: [], removed: [] }, stillCalled: [], shapes: [], gaps: [],
      unresolved: { base: 0, head: 0 },
      counts: { nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0 },
    };
    runVisualise({ config: CONFIG, out: changed, changes, print: () => {} });
    expect(dataOf(readFileSync(changed, 'utf8')).changes).toEqual(changes);
  });

  it('carries the report, so the page can say what joined', () => {
    const { report } = dataOf(page);
    expect(report.httpOut.total).toBeGreaterThan(0);
    expect(report.services.map((service: { name: string }) => service.name).sort()).toEqual([
      'billing',
      'gateway',
      'orders',
      'web',
    ]);
  });

  it('groups what did not join by reason, with one example each', () => {
    const { unresolved } = dataOf(page);
    expect(unresolved.length).toBeGreaterThan(0);
    for (const row of unresolved) {
      expect(row.count).toBeGreaterThan(0);
      expect(typeof row.example).toBe('string');
    }
  });

  it('names the page after the project rather than the folder above it', () => {
    expect(page).toContain('<title>Multi repo map</title>');
  });

  it('takes a name when given one', () => {
    const path = join(scratch, 'named.html');
    runVisualise({ config: CONFIG, out: path, title: 'Ledger', print: () => {} });
    expect(readFileSync(path, 'utf8')).toContain('<title>Ledger</title>');
  });

  it('says where it wrote and how big the answer was', () => {
    const said: string[] = [];
    const result = runVisualise({
      config: CONFIG,
      out: join(scratch, 'said.html'),
      print: (line) => said.push(line),
    });
    expect(said.at(-1)).toBe(result.path);
    expect(said[0]).toMatch(/nodes, .* edges, \d+KB/);
  });

  it('escapes a payload that would otherwise close its own script block', () => {
    // Every `<` is escaped the one way JSON itself understands, so a label
    // holding markup cannot end the block it is written inside.
    expect(page.slice(page.indexOf('id="graph"'))).not.toMatch(/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/);
    expect(() => dataOf(page)).not.toThrow();
  });

  it('writes the graph view’s logic into the page, so it is still one file', () => {
    expect(page).not.toContain('__GRAPH_LOGIC__');
    expect(page).toContain('export const neighbourhood');
    expect(page).toContain('<script type="module">');
  });

  it('writes the frame’s logic in beside it: links, touch, pictures', () => {
    expect(page).not.toContain('__FRAME_LOGIC__');
    expect(page).toContain('export const parseHash');
    expect(page).toContain('export const pinch');
  });

  it('writes the map’s logic in beside them, and ships the map it draws', () => {
    expect(page).not.toContain('__MAP_LOGIC__');
    expect(page).toContain('export const mapLayout');
    expect(page).toContain('export const parseMapHash');
    const { map } = dataOf(page);
    expect(map.boxes.length).toBeGreaterThan(0);
    expect(Array.isArray(map.links)).toBe(true);
  });

  it('writes core’s prompt renderer in ahead of the steps, the one describe_for_prompt writes with (P97)', () => {
    expect(page).not.toContain('__PROMPT_LOGIC__');
    expect(page).toContain(readFileSync(new URL('../../../core/src/prompt-text.js', import.meta.url), 'utf8'));
    expect(page.indexOf('export const renderPrompt')).toBeLessThan(page.indexOf('export const subjectOf'));
    const { ids, nodes } = dataOf(page);
    expect(ids).toHaveLength(nodes.length);
  });

  it('names every node by a key of its own, the same key in the next build', () => {
    const { nodes, keys } = dataOf(page);
    const keyAt = (i: number): string =>
      keys.longer[String(i)] ?? keys.all.slice(i * keys.width, (i + 1) * keys.width);
    const all = nodes.map((_: unknown, i: number) => keyAt(i));
    expect(new Set(all).size).toBe(nodes.length);
    for (const key of all) expect(key).toMatch(/^[a-z][a-z0-9]{5,}$/);

    const again = join(scratch, 'again.html');
    runVisualise({ config: CONFIG, out: again, print: () => {} });
    expect(dataOf(readFileSync(again, 'utf8')).keys).toEqual(keys);
  });

  it('writes a script the browser can parse', () => {
    const opening = '<script type="module">';
    const start = page.indexOf(opening) + opening.length;
    const script = join(scratch, 'page-script.mjs');
    writeFileSync(script, page.slice(start, page.indexOf('</script>', start)));
    expect(() => execFileSync(process.execPath, ['--check', script], { stdio: 'pipe' })).not.toThrow();
  });

  it('carries every row, and the ones that name a node point at it', () => {
    const { rows, nodes, dicts } = dataOf(page);
    expect(rows.length).toBe(dataOf(page).unresolved.reduce((sum: number, u: { count: number }) => sum + u.count, 0));
    const anchored = rows.filter((row: unknown[]) => (row[0] as number) >= 0);
    expect(anchored.length).toBeGreaterThan(0);
    for (const row of anchored) expect(nodes[row[0]]).toBeDefined();
    expect(dicts.reasons.length).toBeGreaterThan(0);
  });

  it('names every metadata key it ships', () => {
    const { nodes, dicts } = dataOf(page);
    for (const node of nodes) {
      for (const key of Object.keys(node[6] || {})) expect(dicts.meta[key]).toBeTypeOf('string');
    }
  });

  it('writes next to the configuration when not told where', () => {
    const result = runVisualise({ config: CONFIG, print: () => {} });
    try {
      expect(result.path).toBe(join(dirname(CONFIG), 'graph.html'));
    } finally {
      rmSync(result.path, { force: true });
    }
    expect(existsSync(result.path)).toBe(false);
  });

  it('keeps a label holding a replacement pattern as written', () => {
    // `$'` and `$&` mean something to String.replace; a project is free to
    // name a route with either.
    const named = join(scratch, 'dollar.html');
    runVisualise({ config: CONFIG, out: named, title: "Cost $' and $&", print: () => {} });
    expect(readFileSync(named, 'utf8')).toContain("<title>Cost $' and $&</title>");
  });

  it('refuses when there is no graph to draw, rather than writing an empty page', () => {
    expect(() =>
      runVisualise({ db: join(scratch, 'nothing.db'), out: join(scratch, 'x.html'), print: () => {} }),
    ).toThrow(/graph\.db not found|not found/);
  });
});

describe('editor links', () => {
  const FIXTURE = dirname(CONFIG);

  it('are off by default, so no local path is written into the page', () => {
    expect(dataOf(page).editor).toBeUndefined();
    expect(page).not.toContain(FIXTURE);
  });

  it('carry each service’s absolute root and the editor when asked for', () => {
    const path = join(scratch, 'editor.html');
    runVisualise({ config: CONFIG, out: path, editorLinks: 'vscode', print: () => {} });
    const { editor, dicts } = dataOf(readFileSync(path, 'utf8'));
    expect(editor.name).toBe('vscode');
    expect(editor.roots).toEqual(dicts.repos.map((name: string) => join(FIXTURE, name)));
  });

  it('refuses an editor it does not know, and a page with nowhere to point', () => {
    expect(() =>
      runVisualise({ config: CONFIG, out: join(scratch, 'e.html'), editorLinks: 'emacs', print: () => {} }),
    ).toThrow(/--editor-links takes one of vscode, cursor, idea, file/);
    expect(() =>
      runVisualise({ db: join(scratch, 'nothing.db'), out: join(scratch, 'e.html'), editorLinks: 'file', print: () => {} }),
    ).toThrow(/needs the configuration/);
  });
});

describe('what the checking tools read', () => {
  it('names the steps of a chain, so impact in the page lengthens the way the command does', () => {
    expect(Array.isArray(dataOf(page).steps)).toBe(true);
  });
});
