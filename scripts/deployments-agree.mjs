#!/usr/bin/env node
/**
 * One deployment, written three ways, must read as one graph (P57).
 *
 *   node scripts/deployments-agree.mjs [graph.json ...]
 *
 * `fixtures/terraform-orders`, `fixtures/serverless-orders` and
 * `fixtures/cdk-orders` deploy the same handlers the same way: in Terraform, in
 * a Serverless Framework file and in a CDK app. The readers of the three feed
 * one shape, and this is the check that they fill it alike: every way in by its
 * kind and key, every channel by its name, and every edge by its type, its two
 * ends and its confidence.
 *
 * What only says where a thing is written is set aside: files, lines, the
 * reader's name, the address of a declaration. A node the deployment declares
 * - a consumer, a publisher a deployment draws, a step of a workflow - has an id
 * built from where it is declared, so it is compared by what it is instead: a
 * consumer by the channels it takes from, a publisher by those it puts on, a
 * step by its workflow and its name. Nodes of the code itself keep their ids,
 * because the code is the same file in all three.
 *
 * With no arguments it compares the three committed snapshots and exits 1 on a
 * difference; with paths, it compares those graphs (a build's own output while
 * a reader is being written).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const ORDERS_FIXTURES = ['terraform-orders', 'serverless-orders', 'cdk-orders'];

/** Whether a node is written in the code the three deployments share. */
const ofCode = (node) => typeof node.file === 'string' && node.file.startsWith('src/');

/** What a graph is, set apart from where each of its parts is written. */
export const projection = (graph) => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const into = new Map();
  const out = new Map();
  for (const edge of graph.edges) {
    if (!into.has(edge.to)) into.set(edge.to, []);
    into.get(edge.to).push(edge);
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(edge);
  }
  const channelsOf = (edges, end, type) =>
    [...new Set((edges ?? []).filter((edge) => edge.type === type && nodes.get(edge[end])?.type === 'channel').map((edge) => edge[end]))].sort().join(',');
  const name = (id) => {
    const node = nodes.get(id);
    if (node === undefined || ['entry', 'channel', 'config_key', 'repo'].includes(node.type) || ofCode(node)) return id;
    if (node.type === 'consumer') return `consumer[${node.kind ?? ''}](${channelsOf(into.get(id), 'from', 'consumes')})`;
    if (node.type === 'producer') return `producer[${node.kind ?? ''}](${channelsOf(out.get(id), 'to', 'emits')})`;
    const prefix = `${node.repo}#${node.file}:`;
    return id.startsWith(prefix) ? `step:${id.slice(prefix.length)}` : id;
  };
  const kept = (node) => node.type !== 'repo';
  return {
    nodes: [...new Set(graph.nodes.filter(kept).map((node) => `${node.type} ${name(node.id)}`))].sort(),
    edges: [...new Set(graph.edges.map((edge) => `${edge.type} ${name(edge.from)} -> ${name(edge.to)} ${edge.confidence ?? ''}`.trim()))].sort(),
  };
};

/** What one projection has and the other does not, both ways. */
export const differences = (left, right) => {
  const only = (a, b) => a.filter((item) => !b.includes(item));
  return {
    nodes: { left: only(left.nodes, right.nodes), right: only(right.nodes, left.nodes) },
    edges: { left: only(left.edges, right.edges), right: only(right.edges, left.edges) },
  };
};

const isEmpty = (found) => [found.nodes.left, found.nodes.right, found.edges.left, found.edges.right].every((list) => list.length === 0);

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths =
    process.argv.length > 2
      ? process.argv.slice(2)
      : ORDERS_FIXTURES.map((name) => join(root, 'fixtures', name, 'expected.project-graph.json'));
  const [first, ...rest] = paths;
  const base = projection(read(first));
  let failed = false;
  for (const path of rest) {
    const found = differences(base, projection(read(path)));
    if (isEmpty(found)) continue;
    failed = true;
    console.log(`${first} and ${path} differ:`);
    for (const [what, sides] of Object.entries(found)) {
      for (const item of sides.left) console.log(`  - ${what}: ${item}`);
      for (const item of sides.right) console.log(`  + ${what}: ${item}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`deployments agree: ${paths.length} graphs, ${base.nodes.length} nodes, ${base.edges.length} edges`);
}
