import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { ExportFile } from './backstage.js';

/**
 * The graph in the formats graph tools read (P237): DOT for Graphviz, GraphML
 * for Gephi and yEd, Cypher for Neo4j and Memgraph, and CSV for anything with
 * a loader. Pure: a selection of nodes and edges in, files out.
 *
 * Every edge says how sure the graph is (I4): an attribute in GraphML, Cypher
 * and CSV, a line style in DOT - dashed for a best guess, dotted for an
 * annotation, bold where traffic was seen. An export that dropped it would
 * turn the tool's guesses into facts in somebody else's tool.
 */
export const GRAPH_FORMATS = ['dot', 'graphml', 'cypher', 'csv'] as const;
export type GraphFormat = (typeof GRAPH_FORMATS)[number];

/** What is drawn: each service as one node, each class, or every node. */
export const GRAPH_LEVELS = ['service', 'class', 'node'] as const;
export type GraphLevel = (typeof GRAPH_LEVELS)[number];

export interface SelectedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes a walk left out under its bound, said in each file. */
  left?: number;
}

/** A node drawn at a level: its key, label, service and type. */
interface Unit {
  id: string;
  label: string;
  service: string;
  type: string;
}

/** An edge between two drawn units, summed: its type, the counts by confidence. */
interface UnitEdge {
  from: string;
  to: string;
  type: string;
  count: number;
  confidence: string;
  observed: boolean;
}

/** `svc#file:Class.method` → `svc#file:Class`; anything else stands for itself. */
const classOf = (node: GraphNode): string => {
  const match = /^([^#]+#[^:]+):([A-Za-z_$][\w$]*)\.[\w$]+$/.exec(node.id);
  return match === null ? node.id : `${match[1]}:${match[2]}`;
};

const CONFIDENCE_RANK: Record<string, number> = { static: 0, runtime: 1, marker: 2, declared: 3, heuristic: 4 };

/** The units and edges of a selection at a level: a service level sums every crossing between two services. */
export const atLevel = (graph: SelectedGraph, level: GraphLevel): { units: Unit[]; edges: UnitEdge[] } => {
  const keyOf = (node: GraphNode): string => (level === 'service' ? `service:${node.repo ?? 'none'}` : level === 'class' ? classOf(node) : node.id);
  const units = new Map<string, Unit>();
  const unitOf = new Map<string, string>();
  for (const node of graph.nodes) {
    const key = keyOf(node);
    unitOf.set(node.id, key);
    if (!units.has(key)) {
      units.set(key, {
        id: key,
        label: level === 'service' ? (node.repo ?? 'none') : level === 'class' && key !== node.id ? (key.split(':').pop() as string) : node.label,
        service: node.repo ?? '',
        type: level === 'service' ? 'service' : level === 'class' && key !== node.id ? 'class' : node.type,
      });
    }
  }
  const edges = new Map<string, UnitEdge>();
  for (const edge of graph.edges) {
    const from = unitOf.get(edge.from);
    const to = unitOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\n${to}\n${edge.type}`;
    const known = edges.get(key);
    const observed = typeof edge.meta?.['observed'] === 'number' && (edge.meta['observed'] as number) > 0;
    if (known === undefined) edges.set(key, { from, to, type: edge.type, count: 1, confidence: edge.confidence, observed });
    else {
      known.count += 1;
      // A sum is as sure as its least sure edge.
      if ((CONFIDENCE_RANK[edge.confidence] ?? 9) > (CONFIDENCE_RANK[known.confidence] ?? 9)) known.confidence = edge.confidence;
      known.observed ||= observed;
    }
  }
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    units: [...units.values()].sort(byId),
    edges: [...edges.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.type < b.type ? -1 : 1)),
  };
};

const dotString = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const DOT_STYLE: Record<string, string> = { heuristic: 'dashed', marker: 'dotted', declared: 'dotted' };

const leftNote = (graph: SelectedGraph): string | undefined =>
  graph.left === undefined || graph.left === 0 ? undefined : `${graph.left} more nodes past the walk's bound were left out (raise --max-nodes)`;

/** Graphviz: one cluster per service below the service level, a line style per confidence. */
export const toDot = (graph: SelectedGraph, level: GraphLevel, name = 'flowatlas'): ExportFile[] => {
  const { units, edges } = atLevel(graph, level);
  const lines = [`digraph ${dotString(name)} {`, '  rankdir=LR;', '  node [shape=box, fontname="Helvetica"];', '  edge [fontname="Helvetica", fontsize=10];'];
  const note = leftNote(graph);
  if (note !== undefined) lines.push(`  // ${note}`);
  if (level === 'service') {
    for (const unit of units) lines.push(`  ${dotString(unit.id)} [label=${dotString(unit.label)}];`);
  } else {
    const byService = new Map<string, Unit[]>();
    for (const unit of units) byService.set(unit.service, [...(byService.get(unit.service) ?? []), unit]);
    let cluster = 0;
    for (const [service, members] of [...byService].sort(([a], [b]) => (a < b ? -1 : 1))) {
      lines.push(`  subgraph cluster_${cluster} {`, `    label=${dotString(service === '' ? 'no service' : service)};`);
      for (const unit of members) lines.push(`    ${dotString(unit.id)} [label=${dotString(unit.label)}, tooltip=${dotString(`${unit.type} ${unit.id}`)}];`);
      lines.push('  }');
      cluster += 1;
    }
  }
  for (const edge of edges) {
    const style = [DOT_STYLE[edge.confidence], edge.observed ? 'bold' : undefined].filter((item) => item !== undefined).join(',');
    const label = level === 'service' ? `${edge.type} ${edge.count}` : edge.count > 1 ? `${edge.type} ×${edge.count}` : edge.type;
    lines.push(`  ${dotString(edge.from)} -> ${dotString(edge.to)} [label=${dotString(label)}${style === '' ? '' : `, style=${dotString(style)}`}, confidence=${dotString(edge.confidence)}];`);
  }
  lines.push('}');
  return [{ path: `graph.${level}.dot`, text: `${lines.join('\n')}\n` }];
};

const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GraphML: keys declared once, every node and edge with its attributes. */
export const toGraphML = (graph: SelectedGraph, level: GraphLevel): ExportFile[] => {
  const { units, edges } = atLevel(graph, level);
  const keys = [
    ['label', 'node', 'string'],
    ['type', 'node', 'string'],
    ['service', 'node', 'string'],
    ['type', 'edge', 'string'],
    ['confidence', 'edge', 'string'],
    ['count', 'edge', 'int'],
    ['observed', 'edge', 'boolean'],
  ] as const;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
    ...keys.map(([name, domain, type]) => `  <key id="${domain[0]}_${name}" for="${domain}" attr.name="${name}" attr.type="${type}"/>`),
    `  <graph id="flowatlas" edgedefault="directed">`,
  ];
  const note = leftNote(graph);
  if (note !== undefined) lines.push(`    <!-- ${xml(note)} -->`);
  for (const unit of units) {
    lines.push(
      `    <node id="${xml(unit.id)}"><data key="n_label">${xml(unit.label)}</data><data key="n_type">${xml(unit.type)}</data><data key="n_service">${xml(unit.service)}</data></node>`,
    );
  }
  edges.forEach((edge, index) => {
    lines.push(
      `    <edge id="e${index}" source="${xml(edge.from)}" target="${xml(edge.to)}"><data key="e_type">${xml(edge.type)}</data><data key="e_confidence">${xml(edge.confidence)}</data><data key="e_count">${edge.count}</data><data key="e_observed">${edge.observed}</data></edge>`,
    );
  });
  lines.push('  </graph>', '</graphml>');
  return [{ path: `graph.${level}.graphml`, text: `${lines.join('\n')}\n` }];
};

const cypherString = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A label Cypher accepts: `http_out` → `HttpOut`. */
const cypherLabel = (type: string): string =>
  type
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('') || 'Node';

/** Cypher: a constraint, then nodes and edges merged in batches, so running it twice changes nothing (D2). */
export const toCypher = (graph: SelectedGraph, level: GraphLevel, batch = 500): ExportFile[] => {
  const { units, edges } = atLevel(graph, level);
  const lines = ['// Written by flowatlas export cypher. Safe to run twice: everything is MERGEd.', 'CREATE CONSTRAINT flowatlas_id IF NOT EXISTS FOR (n:Flowatlas) REQUIRE n.id IS UNIQUE;'];
  const note = leftNote(graph);
  if (note !== undefined) lines.push(`// ${note}`);
  const byType = new Map<string, Unit[]>();
  for (const unit of units) byType.set(unit.type, [...(byType.get(unit.type) ?? []), unit]);
  for (const [type, members] of [...byType].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (let at = 0; at < members.length; at += batch) {
      const rows = members.slice(at, at + batch).map((unit) => `{id: ${cypherString(unit.id)}, label: ${cypherString(unit.label)}, service: ${cypherString(unit.service)}}`);
      lines.push(`UNWIND [${rows.join(', ')}] AS row MERGE (n:Flowatlas {id: row.id}) SET n:${cypherLabel(type)}, n.label = row.label, n.service = row.service, n.type = ${cypherString(type)};`);
    }
  }
  const byEdgeType = new Map<string, UnitEdge[]>();
  for (const edge of edges) byEdgeType.set(edge.type, [...(byEdgeType.get(edge.type) ?? []), edge]);
  for (const [type, members] of [...byEdgeType].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (let at = 0; at < members.length; at += batch) {
      const rows = members
        .slice(at, at + batch)
        .map((edge) => `{from: ${cypherString(edge.from)}, to: ${cypherString(edge.to)}, confidence: ${cypherString(edge.confidence)}, count: ${edge.count}, observed: ${edge.observed}}`);
      lines.push(
        `UNWIND [${rows.join(', ')}] AS row MATCH (a:Flowatlas {id: row.from}), (b:Flowatlas {id: row.to}) MERGE (a)-[r:${type.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}]->(b) SET r.confidence = row.confidence, r.count = row.count, r.observed = row.observed;`,
      );
    }
  }
  return [{ path: `graph.${level}.cypher`, text: `${lines.join('\n')}\n` }];
};

const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Two CSV files in `neo4j-admin import`'s header form, which any loader reads as plain CSV. */
export const toCsv = (graph: SelectedGraph, level: GraphLevel): ExportFile[] => {
  const { units, edges } = atLevel(graph, level);
  const nodes = ['id:ID,label,type,service,:LABEL', ...units.map((unit) => [unit.id, unit.label, unit.type, unit.service, cypherLabel(unit.type)].map(csvCell).join(','))];
  const links = [':START_ID,:END_ID,:TYPE,confidence,count:int,observed:boolean', ...edges.map((edge) => [edge.from, edge.to, edge.type.toUpperCase(), edge.confidence, edge.count, edge.observed].map(csvCell).join(','))];
  return [
    { path: `nodes.${level}.csv`, text: `${nodes.join('\n')}\n` },
    { path: `edges.${level}.csv`, text: `${links.join('\n')}\n` },
  ];
};

/** The files of one format. */
export const graphFiles = (format: GraphFormat, graph: SelectedGraph, level: GraphLevel, name?: string): ExportFile[] =>
  format === 'dot' ? toDot(graph, level, name) : format === 'graphml' ? toGraphML(graph, level) : format === 'cypher' ? toCypher(graph, level) : toCsv(graph, level);
