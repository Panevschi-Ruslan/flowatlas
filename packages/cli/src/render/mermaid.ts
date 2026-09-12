import type { Confidence } from '@flowatlas/core';
import type { CompactNode, FlowNode } from '@flowatlas/mcp';
import { graphOf } from './graphify.js';
import { CONFIDENCE_MARK } from './prefixes.js';
import { serviceOf } from './scope.js';
import type { RenderOptions } from './types.js';

/**
 * Ids the diagram language will accept.
 *
 * Graph ids carry `#`, `:` and `/`, all of which mean something to mermaid, so
 * every id is rewritten. Two ids that flatten to the same name are kept apart
 * by a counter rather than silently merged into one box.
 */
export const sanitiseIds = (ids: readonly string[]): Map<string, string> => {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const id of [...ids].sort()) {
    const base = `n_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
    let name = base;
    let next = 2;
    while (taken.has(name)) {
      name = `${base}_${next}`;
      next += 1;
    }
    taken.add(name);
    names.set(id, name);
  }
  return names;
};

/** Quoted labels still choke on a quote, so the entity goes in instead. */
const quoted = (text: string): string =>
  `"${text.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ')}"`;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const box = (node: CompactNode, name: string): string => {
  if (node.type === 'channel' || node.type === 'producer' || node.type === 'consumer') {
    return `  ${name}[${quoted(node.label)}]`;
  }
  if (node.type === 'entry') return `  ${name}([${quoted(node.label)}])`;
  if (node.type === 'table' || node.type === 'db_query') return `  ${name}[(${quoted(node.label)})]`;
  return `  ${name}[${quoted(node.label)}]`;
};

/**
 * The walk as a diagram, one box per node and one subgraph per repository.
 *
 * A picture of a polyrepo is mostly about which repository a step happens in,
 * so the grouping is the point rather than decoration. An edge is labelled only
 * when it is worth less than proof.
 */
export const renderMermaid = (tree: FlowNode, options: RenderOptions): string => {
  const { nodes, links } = graphOf(tree);
  const names = sanitiseIds(nodes.map((node) => node.id));
  const lines = ['flowchart LR'];

  const grouped = new Map<string, CompactNode[]>();
  const loose: CompactNode[] = [];
  for (const node of nodes) {
    const service = serviceOf(node);
    if (service === undefined) loose.push(node);
    else grouped.set(service, [...(grouped.get(service) ?? []), node]);
  }

  for (const service of [...grouped.keys()].sort(cmp)) {
    const subgraph = `sg_${service.replace(/[^A-Za-z0-9_]/g, '_')}`;
    lines.push(`  subgraph ${subgraph}[${quoted(service)}]`);
    for (const node of grouped.get(service) ?? []) lines.push(`  ${box(node, names.get(node.id) as string)}`);
    lines.push('  end');
  }
  for (const node of loose) lines.push(box(node, names.get(node.id) as string));

  for (const link of links) {
    // The kind of edge is half of what an arrow means: a call, a query and a
    // request to another service are not the same relation, and a diagram that
    // draws them identically says less than the graph knows.
    const mark = CONFIDENCE_MARK[link.confidence as Confidence] ?? '';
    const label = `|${quoted(mark === '' ? link.type : `${link.type} ${mark}`)}|`;
    lines.push(`  ${names.get(link.source) as string} -->${label} ${names.get(link.target) as string}`);
  }

  if (options.truncated !== undefined) lines.push(`  %% truncated: ${options.truncated}`);
  for (const line of options.footer ?? []) lines.push(`  %% ${line}`);
  return `${lines.join('\n')}\n`;
};
