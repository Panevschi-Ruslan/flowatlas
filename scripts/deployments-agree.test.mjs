/**
 * One deployment written in Terraform, as a Serverless Framework service, as a
 * CDK app, as a SAM template and as plain CloudFormation reads as one graph
 * (P57, P246, P248).
 *
 *   node --test scripts/deployments-agree.test.mjs
 *
 * The five snapshots are the build's own, written by `fixtures-check.mjs
 * --update`; this compares what they hold, set apart from where each part is
 * written, and checks that the comparison is not one that passes on anything.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { differences, ORDERS_FIXTURES, projection } from './deployments-agree.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const graphOf = (name) => JSON.parse(readFileSync(join(root, 'fixtures', name, 'expected.project-graph.json'), 'utf8'));

describe('one deployment, five formats', () => {
  const [terraform, ...others] = ORDERS_FIXTURES;
  const base = projection(graphOf(terraform));

  it('holds every kind of way in the Terraform reading draws', () => {
    for (const kind of ['http', 'invoke', 'event', 'cron', 'workflow']) {
      assert.ok(base.nodes.some((node) => node.startsWith(`entry entry:orders:${kind}:`)), `no ${kind} entry`);
    }
    assert.ok(base.edges.some((edge) => edge.startsWith('consumes channel:sqs/orders-dev-placed ')));
  });

  for (const name of others) {
    it(`${name} reads as ${terraform} does`, () => {
      const found = differences(base, projection(graphOf(name)));
      assert.deepEqual(found, { nodes: { left: [], right: [] }, edges: { left: [], right: [] } });
    });
  }

  it('tells two graphs apart when one has an edge the other does not', () => {
    const graph = graphOf(terraform);
    // A `handles` edge, whose ends are named by their ids whatever is dropped.
    const dropped = graph.edges.findIndex((edge) => edge.type === 'handles');
    const fewer = { ...graph, edges: graph.edges.filter((_edge, index) => index !== dropped) };
    const found = differences(base, projection(fewer));
    assert.equal(found.edges.left.length, 1);
  });
});
