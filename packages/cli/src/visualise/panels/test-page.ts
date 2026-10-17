import { readFileSync } from 'node:fs';
import { readAccepted } from '@flowatlas/core';
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
 * one without, a cycle, check rows, and a map.
 */
export const testPack = (name = 'page'): PackedGraph => {
  const { db, dbPath } = buildTestProject(name);
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
}

/**
 * The page mounted on `data`: every panel and then the first view, the way the
 * page boots, or only the panels before `upTo`.
 */
export const mountPage = (data: PackedGraph, options: MountOptions = {}): MountedPage => {
  const window = installDocument(options.markup ?? pageMarkup(), options.address);
  const page = createPageContext(data);
  for (const create of PANELS) {
    if (create === options.upTo) return { page, window, document: window.document };
    Object.assign(page, create(page));
  }
  page.start();
  return { page, window, document: window.document };
};
