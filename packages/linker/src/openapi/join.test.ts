import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseRepoGraph, type GraphEdge, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from '../link.js';
import { readOpenapiDocument } from './read.js';

/**
 * The join itself, run over the fixture, rather than over a graph written here.
 *
 * This file exists because of three rows. The rule that an edge into a declared
 * route is `marker` was written down in a hand-built test and was not in the
 * build: `readOpenapiDocument` really did mark everything it produced, and the
 * three `http_calls` edges the linker drew *into* those routes stayed `static`,
 * because nothing that drew them had been told. A test that builds its own
 * edges cannot catch that — it asserts what happens to an edge somebody already
 * made correctly.
 *
 * So both halves here come from the fixture: the caller's graph as the build
 * wrote it, and the document as the reader reads it. What is asserted is what a
 * person meets, because `impact` and `flow` walk exactly these edges.
 */

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'multi-repo-declared',
);

const callerGraph = (): RepoGraph => {
  const path = join(FIXTURE, 'api', '.flowatlas', 'graph.json');
  // Named rather than skipped. A test that quietly does nothing when its input
  // is missing is a test that passes on the day it matters; `pnpm check` runs
  // the fixtures before the tests, so this only fires for somebody running one
  // package's tests on a clean tree, and then it says what to do.
  if (!existsSync(path)) {
    throw new Error(`${path} is missing — run \`pnpm fixtures:run\` before this test`);
  }
  return parseRepoGraph(JSON.parse(readFileSync(path, 'utf8')));
};

const declaredGraph = (): RepoGraph =>
  readOpenapiDocument(JSON.parse(readFileSync(join(FIXTURE, 'contracts', 'billing.json'), 'utf8')), {
    service: 'billing',
    documentPath: 'contracts/billing.json',
    generatedAt: '2026-01-01T00:00:00.000Z',
  }).graph;

const linked = () => {
  const { config } = loadConfig(join(FIXTURE, 'flowatlas.config.json'));
  return linkGraphs([callerGraph(), declaredGraph()], config, {
    builtAt: '2026-01-01T00:00:00.000Z',
  });
};

/** Every node the document put into the graph, by id. */
const declaredIds = (project: { nodes: Array<{ id: string; meta?: Record<string, unknown> }> }) =>
  new Set(project.nodes.filter((node) => node.meta?.['declaredBy'] !== undefined).map((node) => node.id));

const touching = (edges: readonly GraphEdge[], ids: ReadonlySet<string>): GraphEdge[] =>
  edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to));

describe('the join, where one end is a service nobody could read', () => {
  it('joins the calls at all, so the assertion below is about something', () => {
    const { report } = linked();
    expect(report.httpOut.linked).toBe(3);
    expect(report.httpOut.external).toBe(0);
  });

  it('marks every edge touching a declared node as asserted rather than proven', () => {
    // The three rows this file was written for. The caller's request really was
    // read, but the route it reaches is only somebody's description of itself,
    // and an edge may not claim more than the weakest of its two ends.
    const { project } = linked();
    const ids = declaredIds(project);
    const edges = touching(project.edges, ids);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.filter((edge) => edge.confidence === 'static')).toEqual([]);
  });

  it('weakens the join edges in particular, not merely the document own edges', () => {
    // Said separately because the document's own `handles` edges were already
    // `marker` while the joins were `static`, and an assertion over both
    // together would have passed on two thirds of the graph.
    const { project } = linked();
    const ids = declaredIds(project);
    const joins = project.edges.filter((edge) => edge.type === 'http_calls' && ids.has(edge.to));
    expect(joins.map((edge) => `${edge.confidence} ${edge.to}`).sort()).toEqual([
      'marker entry:billing:http:GET:/customers/:param',
      'marker entry:billing:http:GET:/invoices/:param',
      'marker entry:billing:http:POST:/invoices',
    ]);
  });

  it('leaves an edge between two read services exactly as strong as it was', () => {
    // Only the ends that were declared are weakened. A project whose services
    // are all repositories must be bit for bit what it was before P19.
    const { project } = linked();
    const ids = declaredIds(project);
    const inside = project.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
    expect(inside.some((edge) => edge.confidence === 'static')).toBe(true);
  });
});
