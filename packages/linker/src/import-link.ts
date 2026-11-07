import {
  ENVIRONMENT_META,
  EXPORTS_META,
  importedName,
  IMPORTS_META,
  type EnvironmentValue,
  type ExportedValue,
  type GraphNode,
  type ImportedValue,
  type RepoGraph,
  type Unresolved,
} from '@flowatlas/core';
import { cmp } from './order.js';

/**
 * Values one deployment publishes and another reads, joined by the name both
 * write (P249).
 *
 * A deployment shares a queue, a topic or an API with another by writing it
 * out - an output exported under a name, or read by its stack's name and its
 * own - and the other reads it back by that name. A reader of one repository
 * holds only the name: what it reads is drawn under the name's stand-in
 * (`importedName`), and a value of the environment is kept with the key it
 * waits on. The repository that publishes the value says what it is, on its
 * own node.
 *
 * This runs before the graphs are merged, and renames the stand-in in the
 * importing graph to the name the value has: the importing graph then reads as
 * it would have, had its reader known the name, and the merge joins the queue
 * the producer declares and the one its importer reads into one channel, as it
 * joins any two repositories' channels of one name. Every step after it -
 * completing an address from the environment, matching channel patterns,
 * joining a request to a route - is unchanged.
 *
 * A name no configured service publishes, one two services publish, and one
 * whose value is not read or is not the kind of thing the importer reads are
 * rows at the import, and nothing is renamed.
 */

interface Exporter {
  readonly repo: string;
  readonly value: ExportedValue;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const listAt = <T>(node: GraphNode, key: string): T[] => {
  const value = node.meta?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
};

/** A key as a phrase. */
export const describeKey = (key: string): string => {
  if (key.startsWith('export:')) return `the export ${key.slice('export:'.length)}`;
  if (key.startsWith('stack:')) {
    const [stack, output] = key.slice('stack:'.length).split('#');
    return `the output ${output ?? '?'} of the stack ${stack ?? '?'}`;
  }
  return key;
};

/** What an export is, as a phrase. */
const describeValue = (value: ExportedValue): string =>
  value.kind !== undefined && value.value !== undefined ? `the ${value.kind === 'url' ? "function's URL" : value.kind} ${value.value}` : value.text !== undefined ? `the text ${JSON.stringify(value.text)}` : 'a value not read';

/** Every value each key is published under, by the repositories publishing it. */
const exportersOf = (graphs: readonly RepoGraph[]): Map<string, Exporter[]> => {
  const out = new Map<string, Exporter[]>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.type !== 'repo') continue;
      for (const value of listAt<ExportedValue>(node, EXPORTS_META)) {
        for (const key of value.keys) out.set(key, [...(out.get(key) ?? []), { repo: graph.repo, value }]);
      }
    }
  }
  return out;
};

/** The same value published twice is one export: two stacks of one repository may read alike. */
const distinct = (exporters: readonly Exporter[]): Exporter[] => {
  const seen = new Map<string, Exporter>();
  for (const exporter of exporters) {
    const { kind, value, text, unread } = exporter.value;
    const key = JSON.stringify([exporter.repo, kind, value, text, unread]);
    if (!seen.has(key)) seen.set(key, exporter);
  }
  return [...seen.values()];
};

/** Every string inside a value, rewritten. */
const rewrite = (value: unknown, text: (from: string) => string): unknown => {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, text));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), rewrite(item, text)]));
  return value;
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a value of the environment imported under a key is, once joined. */
type Settled = Pick<EnvironmentValue, 'value' | 'kind' | 'service'>;

/** The values of the environment a function is deployed with, each imported one given what it names. */
const settleEnvironment = (node: GraphNode, settled: ReadonlyMap<string, Settled>): GraphNode => {
  const environment = node.meta?.[ENVIRONMENT_META];
  if (!isRecord(environment)) return node;
  let changed = false;
  const values: Record<string, EnvironmentValue> = {};
  for (const [variable, written] of Object.entries(environment as Record<string, EnvironmentValue>)) {
    const answer = written.imported === undefined ? undefined : settled.get(written.imported);
    if (answer === undefined) {
      values[variable] = written;
      continue;
    }
    changed = true;
    const { unread: _unread, variable: _variable, ...rest } = written;
    values[variable] = { ...rest, ...answer };
  }
  return changed ? { ...node, meta: { ...node.meta, [ENVIRONMENT_META]: values } } : node;
};

/**
 * Joins every import of every graph to its export, renaming stand-ins and
 * settling values of the environment; gives back the graphs, rewritten where
 * they import anything, and a row for each import joined to nothing.
 */
export const joinImports = (graphs: readonly RepoGraph[]): { graphs: RepoGraph[]; rows: Unresolved[] } => {
  const exporters = exportersOf(graphs);
  const rows: Unresolved[] = [];
  const joined = graphs.map((graph): RepoGraph => {
    const imports = graph.nodes.flatMap((node) => (node.type === 'repo' ? listAt<ImportedValue>(node, IMPORTS_META) : []));
    if (imports.length === 0) return graph;
    const byKey = new Map<string, ImportedValue[]>();
    for (const site of imports) byKey.set(site.key, [...(byKey.get(site.key) ?? []), site]);
    const renames = new Map<string, string>();
    const settled = new Map<string, Settled>();
    const from = new Map<string, string>();
    const row = (site: ImportedValue, reason: string, message: string, hint: string): void => {
      rows.push({ service: graph.repo, file: site.file, line: site.line, reason, message, hint, symbol: `import:${site.key}`, meta: { key: site.key } });
    };
    for (const key of [...byKey.keys()].sort(cmp)) {
      const sites = byKey.get(key) ?? [];
      const found = distinct(exporters.get(key) ?? []);
      if (found.length === 0) {
        for (const site of sites) {
          row(site, 'export-not-found', `${site.what} is ${describeKey(key)}, which no configured service publishes, so what it names is not joined`, 'Add the repository whose deployment declares that output to the configuration, or check the name on both sides.');
        }
        continue;
      }
      if (found.length > 1) {
        for (const site of sites) {
          row(site, 'export-ambiguous', `${site.what} is ${describeKey(key)}, which ${found.map((exporter) => `${exporter.repo} publishes as ${describeValue(exporter.value)}`).join(' and ')}`, 'A name is exported once where both are deployed; one of the two is stale, or they are two environments the configuration should tell apart.');
        }
        continue;
      }
      const [exporter] = found as [Exporter];
      const { value } = exporter;
      if (value.unread !== undefined) {
        for (const site of sites) row(site, 'export-mismatched', `${site.what} is ${describeKey(key)}, which ${exporter.repo} publishes with a value that is not read: ${value.unread}`, 'Write the output so its value names what it is - a Ref or Fn::GetAtt of a resource the stack declares - or a name the files settle.');
        continue;
      }
      const wrong = sites.filter((site) => site.kinds !== undefined && (value.kind === undefined || !site.kinds.includes(value.kind)));
      if (wrong.length > 0) {
        for (const site of wrong) row(site, 'export-mismatched', `${site.what} is ${describeKey(key)}, a ${(site.kinds ?? []).join(' or ')} where it is read, which ${exporter.repo} publishes as ${describeValue(value)}`, 'The two sides name different things: point the import at the output that is what it reads, or fix the output.');
        continue;
      }
      from.set(key, exporter.repo);
      if (value.kind !== undefined && value.value !== undefined) {
        renames.set(importedName(key), value.value);
        settled.set(key, { value: value.value, kind: value.kind, ...(value.kind === 'api' ? { service: exporter.repo } : {}) });
      } else if (value.text !== undefined) {
        settled.set(key, { value: value.text });
      }
    }
    if (renames.size === 0 && settled.size === 0) return graph;
    // A stand-in ends where the characters a key may hold end, so one key's is never read inside another's.
    const pattern = new RegExp(`(?:${[...renames.keys()].sort((a, b) => b.length - a.length).map(escaped).join('|') || '(?!)'})(?![\\w.#:-])`, 'g');
    const text = (written: string): string => (renames.size === 0 || !written.includes('@import.') ? written : written.replace(pattern, (whole) => renames.get(whole) ?? whole));
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const renamed = rewrite(node, text) as GraphNode;
        const imports = renamed.type === 'repo' ? listAt<ImportedValue>(renamed, IMPORTS_META) : [];
        const marked =
          imports.length === 0
            ? renamed
            : { ...renamed, meta: { ...renamed.meta, [IMPORTS_META]: imports.map((site) => (from.has(site.key) ? { ...site, from: from.get(site.key) } : site)) } };
        return settleEnvironment(marked, settled);
      }),
      edges: graph.edges.map((edge) => rewrite(edge, text) as typeof edge),
      unresolved: graph.unresolved.map((found) => rewrite(found, text) as Unresolved),
    };
  });
  return { graphs: joined, rows };
};
