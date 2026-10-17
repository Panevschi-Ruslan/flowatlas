import { readFileSync } from 'node:fs';
import { readAccepted, saveAccepted, type AcceptedGap, type Unresolved } from '@flowatlas/core';
import { packDatabase } from '../../commands/visualise.js';
import { buildTestProject } from '../../test-graph.js';
import { createModel, type GraphModel } from '../graph.js';
import type { PackedGraph } from '../pack.js';
import { stepIdOf } from '../steps.js';
import { PANELS } from './boot.js';
import { createPageContext } from './context.js';
import type { Page } from './page.js';
import { installDocument, type FakeDocument, type FakeWindow } from './test-dom.js';

/**
 * The page in a test (P103): its markup in a test document, its context built
 * from a packed graph, and its panels set up in the order the page sets them
 * up. A panel's test mounts the page up to that panel, calls its factory, and
 * looks at what it drew.
 */

/** The body `page.html` holds - the markup every panel finds its elements in - without its scripts. */
export const pageMarkup = (): string => {
  const html = readFileSync(new URL('../page.html', import.meta.url), 'utf8');
  return html.slice(html.indexOf('<div class="shell">'), html.indexOf('<script'));
};

/**
 * The test project (test-graph.ts) packed as the command packs it: three
 * services, a guard chain, a cross-service call, a channel with a handler and
 * one without, a cycle, check rows, and a map. `extra` adds check rows, and
 * what `flowatlas accept` wrote beside the database.
 */
export const testPack = (
  name = 'page',
  extra: { unresolved?: readonly Unresolved[]; accepted?: readonly AcceptedGap[] } = {},
): PackedGraph => {
  const { db, dbPath } = buildTestProject(name, extra.unresolved === undefined ? {} : { unresolved: extra.unresolved });
  if (extra.accepted !== undefined) saveAccepted(dbPath, extra.accepted);
  try {
    return packDatabase(db, readAccepted(dbPath));
  } finally {
    db.close();
  }
};

/** A node's position in `data`, by its id: `nodeAt(data)('channel:order.created')`. */
export const nodeAt = (data: PackedGraph): ((id: string) => number) => {
  const model = createModel(data) as GraphModel;
  const at = new Map(data.nodes.map((_, i) => [stepIdOf(model, i), i]));
  return (id) => {
    const v = at.get(id);
    if (v === undefined) throw new Error(`the test graph has no node ${id}`);
    return v;
  };
};

export interface MountedPage {
  page: Page;
  window: FakeWindow;
  document: FakeDocument;
}

export interface MountOptions {
  /** The markup to mount; the page's own by default. */
  markup?: string;
  /** Stop before this panel's factory, which the test then calls itself. */
  upTo?: (page: Page) => Record<string, unknown>;
  /** The address the page is opened at, hash and all. */
  address?: string;
  /** How wide the window is, for the media queries the page asks (P102); 1280 by default. */
  width?: number;
}

/**
 * The page mounted on `data`: every panel and then the first view, the way the
 * page boots, or only the panels before `upTo`.
 */
export const mountPage = (data: PackedGraph, options: MountOptions = {}): MountedPage => {
  const window = installDocument(options.markup ?? pageMarkup(), options.address, options.width);
  const page = createPageContext(data);
  for (const create of PANELS) {
    if (create === options.upTo) return { page, window, document: window.document };
    Object.assign(page, create(page));
  }
  page.start();
  return { page, window, document: window.document };
};

/**
 * `data` with `count` services (P98): its own, then `svc-04`, `svc-05`… -
 * tiny ones the report names and no node is in - so a test can see the rail
 * past a dozen services without building thirty repositories.
 */
export const withServices = (data: PackedGraph, count: number): PackedGraph => {
  const names = [...data.dicts.repos];
  while (names.length < count) names.push('svc-' + String(names.length + 1).padStart(2, '0'));
  const report = data.report as { services: Array<{ name: string }> };
  const services = names.map((name, i) => report.services.find((service) => service.name === name) ??
    { name, type: i % 3 === 0 ? 'express' : 'nestjs', nodes: 3 + i, edges: 2, unresolved: 0, durationMs: 10 + i, skipped: null });
  return { ...data, dicts: { ...data.dicts, repos: names }, report: { ...report, services } };
};

/**
 * `data` with `count` more ways in (P102): copies of its first entry, routed
 * `GET /bulk/0001`… and joined to nothing, so a test can see the Ways in list
 * hold thousands without building a project that large.
 */
export const withWays = (data: PackedGraph, count: number): PackedGraph => {
  const types = data.dicts.types as readonly string[];
  const first = data.nodes.find((node) => types[node[0] as number] === 'entry');
  if (first === undefined) throw new Error('the test graph has no way in to copy');
  const copies = Array.from({ length: count }, (_, n) => {
    const path = '/bulk/' + String(n + 1).padStart(4, '0');
    const copy = [...first];
    copy[1] = 'GET ' + path;
    copy[6] = { ...(first[6] as object | null ?? {}), m: 'GET', p: path };
    return copy;
  });
  return { ...data, nodes: [...data.nodes, ...copies] };
};
