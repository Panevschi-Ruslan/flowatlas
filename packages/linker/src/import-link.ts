import {
  alternativeOf,
  ENVIRONMENT_META,
  EXPORTS_META,
  importedName,
  IMPORTS_META,
  isGeneratedName,
  makeEntryReference,
  makeInvokeEntryKey,
  makeWorkflowEntryKey,
  ownedGeneratedName,
  REACHED_AS_META,
  REACHES_META,
  UNREAD_SPAN,
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
 *
 * Two things more are settled here (P253). A declaration whose use of an
 * import does not say what kind of thing it is - a mapping that reads a
 * stream or a table's changes, a destination - was drawn once per kind it may
 * be, each under its own address; the one the publisher's value is is kept,
 * under the address it was written at, and the others are dropped with what
 * only they drew. And a value the publisher names by a stand-in for a name
 * the platform generates is that publisher's own: the stand-in is given the
 * publisher's repository, in both graphs, so the importer meets the
 * producer's channel and no other repository's that happens to declare
 * something unnamed at the same address.
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
  if (key.startsWith('parameter:')) return `the parameter ${key.slice('parameter:'.length)}`;
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

/** A value the importer reads as the name of what it names: text with nothing in it an address is split on (P253). */
const isPlainName = (text: string): boolean => text !== '' && !/[:/\s]/.test(text);

/** Every name built of several values a graph imports, with the keys of its parts (P259). */
const builtNames = (imports: readonly ImportedValue[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const site of imports) {
    if (site.within === undefined) continue;
    const keys = out.get(site.within) ?? [];
    if (!keys.includes(site.key)) keys.push(site.key);
    out.set(site.within, keys);
  }
  return out;
};

/** A built name with each part's stand-in replaced by what the part is, the longest stand-in first. */
const fill = (within: string, keys: readonly string[], parts: ReadonlyMap<string, string>): string =>
  [...keys]
    .sort((a, b) => importedName(b).length - importedName(a).length)
    .reduce((name, key) => name.split(importedName(key)).join(parts.get(key) as string), within);

/** What joining one graph's imports decided, before anything of it is rewritten. */
interface Plan {
  /** Every stand-in, by what it is renamed to. */
  readonly renames: Map<string, string>;
  /** What each value of the environment imported under a key is, once joined. */
  readonly settled: Map<string, Settled>;
  /** The repository each key was joined to. */
  readonly from: Map<string, string>;
  /** The addresses of readings of a declaration that are not what the publisher's value is, and the references only they made. */
  readonly dropped: Set<string>;
  readonly references: Set<string>;
  /** The stand-ins whose readings were dropped: a channel of one left with nothing is dropped too. */
  readonly standIns: Set<string>;
}

/** The references a reading of a declaration as `kind` made by the stand-in `name`, which only it made. */
const referencesOf = (kind: string, name: string): string[] =>
  kind === 'function' ? [makeEntryReference('invoke', makeInvokeEntryKey(name))] : kind === 'workflow' ? [makeEntryReference('workflow', makeWorkflowEntryKey(name))] : [];

/** Whether something drawn belongs to a reading that is dropped: by its id, or by the address it says it is declared at. */
const droppedBy = (dropped: ReadonlySet<string>, id: string, declaredAs: unknown): boolean =>
  dropped.size > 0 && (dropped.has(String(declaredAs)) || [...dropped].some((address) => id.includes(address)));

/** A graph without the readings of a declaration that are dropped, what only they reached, and a channel of a dropped stand-in left with nothing. */
const prune = (graph: RepoGraph, plan: Plan): RepoGraph => {
  if (plan.dropped.size === 0 && plan.references.size === 0) return graph;
  const gone = new Set(graph.nodes.filter((node) => droppedBy(plan.dropped, node.id, node.meta?.['declaredAs'])).map((node) => node.id));
  let edges = graph.edges.filter((edge) => !gone.has(edge.from) && !gone.has(edge.to));
  const touched = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  for (const node of graph.nodes) {
    if (gone.has(node.id) || touched.has(node.id) || node.type !== 'channel') continue;
    if ([...plan.standIns].some((name) => node.id.includes(name))) gone.add(node.id);
  }
  edges = edges.filter((edge) => !gone.has(edge.from) && !gone.has(edge.to));
  const unreached = (node: GraphNode): GraphNode => {
    if (plan.references.size === 0 || node.meta === undefined) return node;
    const reaches = node.meta[REACHES_META];
    const reachedAs = node.meta[REACHED_AS_META];
    if (!Array.isArray(reaches) && !isRecord(reachedAs)) return node;
    const { [REACHES_META]: _reaches, [REACHED_AS_META]: _reachedAs, ...rest } = node.meta;
    const kept = Array.isArray(reaches) ? (reaches as string[]).filter((reference) => !plan.references.has(reference)) : [];
    const keptAs = isRecord(reachedAs) ? Object.fromEntries(Object.entries(reachedAs).filter(([reference]) => !plan.references.has(reference))) : {};
    return { ...node, meta: { ...rest, ...(kept.length === 0 ? {} : { [REACHES_META]: kept }), ...(Object.keys(keptAs).length === 0 ? {} : { [REACHED_AS_META]: keptAs }) } };
  };
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !gone.has(node.id)).map(unreached),
    edges,
    unresolved: graph.unresolved.filter((found) => !droppedBy(plan.dropped, found.symbol ?? '', found.symbol)),
  };
};

/**
 * Joins every import of every graph to its export, renaming stand-ins and
 * settling values of the environment; gives back the graphs, rewritten where
 * they import anything, and a row for each import joined to nothing.
 */
export const joinImports = (graphs: readonly RepoGraph[]): { graphs: RepoGraph[]; rows: Unresolved[] } => {
  const exporters = exportersOf(graphs);
  const rows: Unresolved[] = [];
  /** A generated name another repository imports, by the repository that generates it: what it is renamed to there too. */
  const owned = new Map<string, Map<string, string>>();
  const plans = graphs.map((graph): Plan | undefined => {
    const imports = graph.nodes.flatMap((node) => (node.type === 'repo' ? listAt<ImportedValue>(node, IMPORTS_META) : []));
    if (imports.length === 0) return undefined;
    const byKey = new Map<string, ImportedValue[]>();
    for (const site of imports) byKey.set(site.key, [...(byKey.get(site.key) ?? []), site]);
    const plan: Plan = { renames: new Map(), settled: new Map(), from: new Map(), dropped: new Set(), references: new Set(), standIns: new Set() };
    /** What each joined key is as a part of a name: the name it publishes, or its text where that is a name. */
    const parts = new Map<string, string>();
    const row = (site: ImportedValue, reason: string, message: string, hint: string): void => {
      rows.push({ service: graph.repo, file: site.file, line: site.line, reason, message, hint, symbol: `import:${site.key}`, meta: { key: site.key } });
    };
    /** The readings of a site's declaration kept: the one of `kind`, or none. */
    const choose = (site: ImportedValue, kind: string | undefined): void => {
      for (const alternative of site.alternatives ?? []) {
        if (alternative.kind === kind) {
          const written = alternativeOf(alternative.address);
          if (written !== undefined) plan.renames.set(alternative.address, written.address);
          continue;
        }
        plan.dropped.add(alternative.address);
        plan.standIns.add(importedName(site.key));
        for (const reference of referencesOf(alternative.kind, importedName(site.key))) plan.references.add(reference);
      }
    };
    for (const key of [...byKey.keys()].sort(cmp)) {
      const sites = byKey.get(key) ?? [];
      const found = distinct(exporters.get(key) ?? []);
      if (found.length === 0) {
        for (const site of sites) {
          row(site, 'export-not-found', `${site.what} is ${describeKey(key)}, which no configured service publishes, so what it names is not joined`, key.startsWith('parameter:') ? 'Add the repository whose deployment writes that parameter to the configuration, or check the name on both sides.' : 'Add the repository whose deployment declares that output to the configuration, or check the name on both sides.');
          choose(site, undefined);
        }
        continue;
      }
      if (found.length > 1) {
        for (const site of sites) {
          row(site, 'export-ambiguous', `${site.what} is ${describeKey(key)}, which ${found.map((exporter) => `${exporter.repo} publishes as ${describeValue(exporter.value)}`).join(' and ')}`, 'A name is exported once where both are deployed; one of the two is stale, or they are two environments the configuration should tell apart.');
          choose(site, undefined);
        }
        continue;
      }
      const [exporter] = found as [Exporter];
      const { value } = exporter;
      if (value.unread !== undefined) {
        for (const site of sites) {
          row(site, 'export-mismatched', `${site.what} is ${describeKey(key)}, which ${exporter.repo} publishes with a value that is not read: ${value.unread}`, 'Write the output so its value names what it is - a Ref or Fn::GetAtt of a resource the stack declares - or a name the files settle.');
          choose(site, undefined);
        }
        continue;
      }
      // A name published as text is the name of what a site that reads it as one says it is (P253).
      const named = (site: ImportedValue): boolean => site.as === 'name' && value.kind === undefined && value.text !== undefined && isPlainName(value.text);
      const wrong = sites.filter((site) => site.kinds !== undefined && !named(site) && (value.kind === undefined || !site.kinds.includes(value.kind)));
      if (wrong.length > 0) {
        for (const site of wrong) {
          row(site, 'export-mismatched', `${site.what} is ${describeKey(key)}, a ${(site.kinds ?? []).join(' or ')} where it is read, which ${exporter.repo} publishes as ${describeValue(value)}`, 'The two sides name different things: point the import at the output that is what it reads, or fix the output.');
        }
        for (const site of sites) choose(site, undefined);
        continue;
      }
      for (const site of sites) choose(site, value.kind);
      plan.from.set(key, exporter.repo);
      if (value.kind !== undefined && value.value !== undefined) {
        // A name the publisher's platform generates is the publisher's, by its repository (P253).
        const name = isGeneratedName(value.value) && exporter.repo !== graph.repo ? ownedGeneratedName(exporter.repo, value.value) : value.value;
        if (name !== value.value) owned.set(exporter.repo, (owned.get(exporter.repo) ?? new Map<string, string>()).set(value.value, name));
        plan.renames.set(importedName(key), name);
        plan.settled.set(key, { value: name, kind: value.kind, ...(value.kind === 'api' ? { service: exporter.repo } : {}) });
        parts.set(key, name);
      } else if (value.text !== undefined) {
        if (sites.some(named)) plan.renames.set(importedName(key), value.text);
        plan.settled.set(key, { value: value.text });
        if (isPlainName(value.text)) parts.set(key, value.text);
      }
    }
    // A name built of several values, or of one and text, is written where every part of it is joined, and kept whole otherwise (P259).
    for (const [within, keys] of builtNames(imports)) plan.renames.set(within, keys.every((key) => parts.has(key)) ? fill(within, keys, parts) : within);
    return plan;
  });
  const joined = graphs.map((graph, index): RepoGraph => {
    const own = owned.get(graph.repo);
    const plan = plans[index] ?? (own === undefined ? undefined : { renames: new Map(), settled: new Map(), from: new Map(), dropped: new Set(), references: new Set(), standIns: new Set() });
    if (plan === undefined) return graph;
    // The producer's own generated names, where another repository imports them; and an import of its own of one, to the same.
    for (const [name, to] of own ?? []) plan.renames.set(name, to);
    for (const [from, to] of plan.renames) if (own?.has(to) === true) plan.renames.set(from, own.get(to) as string);
    for (const [key, answer] of plan.settled) if (answer.value !== undefined && own?.has(answer.value) === true) plan.settled.set(key, { ...answer, value: own.get(answer.value) as string });
    const pruned = prune(graph, plan);
    const { renames, settled, from } = plan;
    if (renames.size === 0 && settled.size === 0 && pruned === graph) return graph;
    // A stand-in ends where the characters a key may hold end, so one key's is never read inside another's.
    const pattern = new RegExp(`(?:${[...renames.keys()].sort((a, b) => b.length - a.length).map(escaped).join('|') || '(?!)'})(?![\\w.#:-])`, 'g');
    const text = (written: string): string => (renames.size === 0 || !written.includes(UNREAD_SPAN) ? written : written.replace(pattern, (whole) => renames.get(whole) ?? whole));
    return {
      ...pruned,
      nodes: pruned.nodes.map((node) => {
        const renamed = rewrite(node, text) as GraphNode;
        const imports = renamed.type === 'repo' ? listAt<ImportedValue>(renamed, IMPORTS_META) : [];
        const marked =
          imports.length === 0
            ? renamed
            : {
                ...renamed,
                meta: {
                  ...renamed.meta,
                  [IMPORTS_META]: imports.map(({ alternatives: _alternatives, ...site }) => (from.has(site.key) ? { ...site, from: from.get(site.key) } : site)),
                },
              };
        return settleEnvironment(marked, settled);
      }),
      edges: pruned.edges.map((edge) => rewrite(edge, text) as typeof edge),
      unresolved: pruned.unresolved.map((found) => rewrite(found, text) as Unresolved),
    };
  });
  return { graphs: joined, rows };
};
