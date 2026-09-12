import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runVisualise } from './visualise.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-visualise-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

let page: string;
let out: string;

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

describe('writing the graph as a page', () => {
  it('is one file with nothing to fetch', () => {
    expect(page).toContain('<script type="application/json" id="graph">');
    expect(page).not.toContain('fetch(');
    expect(page).not.toMatch(/<script[^>]+src=/);
  });

  it('carries the whole graph, not a sample of it', () => {
    const data = dataOf(page);
    expect(data.nodes.length).toBeGreaterThan(50);
    expect(data.edges.length).toBeGreaterThan(50);
    expect(Object.keys(data.entryIds).length).toBeGreaterThan(0);
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

  it('refuses when there is no graph to draw, rather than writing an empty page', () => {
    expect(() =>
      runVisualise({ db: join(scratch, 'nothing.db'), out: join(scratch, 'x.html'), print: () => {} }),
    ).toThrow(/graph\.db not found|not found/);
  });
});
