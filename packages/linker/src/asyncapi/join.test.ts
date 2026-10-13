import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECLARED_CONFIDENCE, loadConfig, parseRepoGraph, type RepoGraph } from '@flowatlas/core';
import { checkContracts } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from '../link.js';
import { readAsyncapiDocument } from './read.js';

/**
 * The join itself, run over the fixture, rather than over a graph written here.
 *
 * The ticket this file closes was raised believing that a channel end needed
 * both a new reader and a new joining, and half of that was wrong. There is
 * nothing to join: `emits` is born in the publisher's graph, `consumes` in the
 * consumer's, and they meet because a channel id has no repository half. A test
 * that built both ends itself could not show that, because it would be asserting
 * something about a graph it had already put together. So both halves here come
 * from the fixture — the publisher's graph as the build wrote it, and the
 * documents as the reader reads them — and what is asserted is a pair the
 * contract check found on its own.
 */

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'multi-repo-asyncapi',
);

const readGraph = (): RepoGraph => {
  // Under the build's output, where a build keeps each service's graph (R166).
  const path = join(FIXTURE, '.flowatlas', 'services', 'orders', 'graph.json');
  // Named rather than skipped. A test that quietly does nothing when its input
  // is missing is a test that passes on the day it matters; `pnpm check` runs the
  // fixtures before the tests, so this only fires for somebody running one
  // package's tests on a clean tree, and then it says what to do.
  if (!existsSync(path)) {
    throw new Error(`${path} is missing — run \`pnpm fixtures:run\` before this test`);
  }
  return parseRepoGraph(JSON.parse(readFileSync(path, 'utf8')));
};

const declaredGraph = (service: string, file: string): RepoGraph =>
  readAsyncapiDocument(JSON.parse(readFileSync(join(FIXTURE, 'contracts', file), 'utf8')), {
    service,
    documentPath: `contracts/${file}`,
    generatedAt: '2026-01-01T00:00:00.000Z',
  }).graph;

const linked = () => {
  const { config } = loadConfig(join(FIXTURE, 'flowatlas.config.json'));
  return linkGraphs(
    [
      readGraph(),
      declaredGraph('billing', 'billing.asyncapi.json'),
      declaredGraph('analytics', 'analytics.asyncapi.json'),
    ],
    config,
    { builtAt: '2026-01-01T00:00:00.000Z' },
  );
};

const findings = () =>
  checkContracts(linked().project, { generatedAt: '2026-01-01T00:00:00.000Z' }).findings.map(
    (finding) => `${finding.severity} ${finding.kind} ${finding.field}`,
  );

describe('a channel where one end is a service nobody could read', () => {
  it('joins with no join edge, because there is nothing to join', () => {
    // The whole finding behind R79. Every channel has both ends and not one edge
    // was created by the linker to make that true: the ids met.
    const { report } = linked();
    expect(report.channels).toMatchObject({
      total: 2,
      linked: 2,
      noConsumers: [],
      noProducers: [],
    });
  });

  it('compares the pair, and says which half was believed', () => {
    const report = checkContracts(linked().project, { generatedAt: '2026-01-01T00:00:00.000Z' });
    const said = report.findings.map((finding) => finding.message);
    expect(said.some((message) => message.includes('billing was declared by contracts/billing.asyncapi.json, not read'))).toBe(true);
    expect(said.every((message) => message.includes('not read'))).toBe(true);
  });

  it('finds the disagreements in both directions', () => {
    // `orders → billing` has the declared end receiving, `billing → orders` has
    // it sending. A reader that had the version-2 words the wrong way round, or
    // the edge orientation reversed, still produces a graph that joins — and the
    // shapes it compares are each other's.
    expect(findings().sort()).toEqual([
      'error missing_required currency',
      'error type_mismatch amount',
      'warning optionality_mismatch customerId',
      'warning optionality_mismatch total',
      'warning optionality_mismatch total',
    ]);
  });

  it('leaves the read publisher exactly as strong as it was', () => {
    // Only what the documents declared is weakened. `emits` out of the
    // repository is `static` and stays `static`: nothing weakens an edge for
    // having a declared node at the far end of a shared channel, because no edge
    // spans the two.
    const { project } = linked();
    const emits = project.edges.filter((edge) => edge.type === 'emits');
    expect(
      emits.map((edge) => `${edge.confidence} ${edge.from.split('#')[0]}`).sort(),
    ).toEqual(['declared producer:billing', 'static producer:orders']);
  });

  it('says declared, never marker, about anything a document contributed', () => {
    const { project } = linked();
    const ids = new Set(
      project.nodes.filter((node) => node.meta?.['declaredBy'] !== undefined).map((node) => node.id),
    );
    const touching = project.edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.every((edge) => edge.confidence === DECLARED_CONFIDENCE)).toBe(true);
  });
});
