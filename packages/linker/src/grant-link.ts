import {
  ADDRESS_SEPARATOR,
  GRANTABLE_META,
  GRANTS_META,
  isDeployedEntryKind,
  makeChannelId,
  makeDeployedReference,
  REACHES_META,
  STARTS_META,
  type GrantableAddress,
  type GrantValue,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { reachedBy } from './environment-link.js';
import { cmp, edgeKey } from './order.js';

/**
 * Where a send goes that does not say, from what its function is allowed to
 * send to (P272).
 *
 * A publisher whose address the code decides when it runs - a queue's URL
 * looked up in a cache the code fills by listing the account's queues - is a
 * row and no edge. The function that runs it can still send only where its
 * role lets it, and the deployment says where that is: a policy template on a
 * queue, a statement on a topic's ARN, a construct's grant. Where every
 * function that runs the call is granted a few things of the kind the address
 * names, by name, each of them is drawn, as a guess: a grant is an upper bound
 * and not an address, which the edge (`via: grant`) and a note say. A grant on
 * every one of the kind - `*`, an ARN ending in `*`, a managed full-access
 * policy - bounds nothing, and the row the extractor wrote stays, saying so.
 *
 * Asked only of a publisher no other reading placed: an address the code
 * writes, or the environment completes, is where it sends, whatever else the
 * role allows.
 */

const grantsOf = (fn: GraphNode): readonly GrantValue[] => (fn.meta?.[GRANTS_META] as GrantValue[] | undefined) ?? [];

/** The rows that said this publisher's address is not read: an extractor's, or the environment's. */
const isAddressRow = (row: Unresolved, producer: GraphNode): boolean =>
  row.symbol === producer.id && /^(channel|start|environment)-/.test(row.reason) && row.reason !== 'environment-from-files';

/** The first sentence of a text, its full stop dropped. */
const firstSentence = (text: string | undefined): string | undefined => {
  if (text === undefined || text === '') return undefined;
  const end = text.search(/\.(\s|$)/);
  return end < 0 ? text : text.slice(0, end);
};

/** A grant on more than its kind's few: what it is written as. */
const openOf = (grant: GrantValue): string => grant.any ?? `a resource not read (${grant.unread ?? 'it is not known from the files'})`;

/** What one function's grants make of one address. */
type Bound = { readonly names: readonly { name: string; by: string }[] } | { readonly open: readonly GrantValue[] };

const boundBy = (address: GrantableAddress, grants: readonly GrantValue[]): Bound | undefined => {
  const kind = address.parts.find((part): part is { granted: string } => typeof part !== 'string')?.granted;
  const ofKind = grants.filter((grant) => grant.kind === kind);
  if (ofKind.length === 0) return undefined;
  const open = ofKind.filter((grant) => grant.name === undefined);
  if (open.length > 0) return { open };
  return {
    names: ofKind.map((grant) => ({
      name: address.parts.map((part) => (typeof part === 'string' ? part : (grant.name as string))).join(ADDRESS_SEPARATOR),
      by: grant.by,
    })),
  };
};

/** The kind an address leaves open, for a sentence. */
const kindOf = (address: GrantableAddress): string =>
  address.parts.find((part): part is { granted: string } => typeof part !== 'string')?.granted ?? 'thing';

/** One target a grant bounds a publisher to, and for whom. */
interface Granted {
  readonly functions: Set<string>;
  readonly by: Set<string>;
  readonly payload?: string;
}

/** Draws every publisher a grant bounds, in place, and returns the rows that say so. */
export const boundByGrants = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  /** The rows written so far, each list searched for the rows about a publisher drawn here. */
  rowLists: readonly Unresolved[][],
): Unresolved[] => {
  const functions = [...nodes.values()].filter((node) => node.type === 'entry' && grantsOf(node).length > 0).sort((a, b) => cmp(a.id, b.id));
  if (functions.length === 0) return [];
  const producers = [...nodes.values()].filter((node) => Array.isArray(node.meta?.[GRANTABLE_META])).sort((a, b) => cmp(a.id, b.id));
  if (producers.length === 0) return [];
  const reached = reachedBy(nodes, edges, functions);
  const out = new Set<string>();
  for (const edge of edges.values()) if (edge.type === 'emits') out.add(edge.from);
  const findings: Unresolved[] = [];
  for (const producer of producers) {
    const runners = reached.get(producer.id) ?? [];
    // Placed by the code or the environment already: that is where it sends.
    const reaches = (producer.meta?.[REACHES_META] as string[] | undefined) ?? [];
    if (runners.length === 0 || out.has(producer.id) || reaches.length > 0) continue;
    const addresses = producer.meta?.[GRANTABLE_META] as GrantableAddress[];
    const granted = new Map<string, Granted>();
    const open: { fn: GraphNode; grants: readonly GrantValue[]; kind: string }[] = [];
    for (const address of addresses) {
      for (const fn of runners) {
        const bound = boundBy(address, grantsOf(fn));
        if (bound === undefined) continue;
        if ('open' in bound) {
          if (!open.some((each) => each.fn.id === fn.id)) open.push({ fn, grants: bound.open, kind: kindOf(address) });
          continue;
        }
        for (const { name, by } of bound.names) {
          const found = granted.get(name) ?? { functions: new Set(), by: new Set(), ...(address.payload === undefined ? {} : { payload: address.payload }) };
          found.functions.add(fn.label);
          found.by.add(by);
          granted.set(name, found);
        }
      }
    }
    const said = (fn: GraphNode, grants: readonly GrantValue[], kind: string): string =>
      `${fn.label} is granted every ${kind} by ${grants.map((grant) => `${grant.by} on ${openOf(grant)}`).join(', ')}, which bounds nothing`;
    const rows = rowLists.flatMap((list) => list.filter((row) => isAddressRow(row, producer)));
    if (granted.size === 0) {
      // A grant on everything: the row that said the address is not read stays, and says so.
      if (open.length === 0) continue;
      const wide = open.map(({ fn, grants, kind }) => said(fn, grants, kind)).join('; ');
      for (const row of rows) {
        row.hint = `${row.hint ?? ''}${row.hint === undefined ? '' : ' '}What its function is granted does not narrow it: ${wide}.`;
        row.meta = { ...row.meta, grantedEvery: open.map(({ fn, grants }) => ({ function: fn.label, resources: grants.map(openOf) })) };
      }
      continue;
    }
    const names = [...granted.keys()].sort(cmp);
    // What the rows said of the address, in their own words: the first sentence of their advice says why.
    const before = [...new Set(rows.map((row) => firstSentence(row.hint) ?? row.message ?? row.reason))];
    const reasons = [...new Set(rows.map((row) => row.reason))].sort(cmp);
    for (const list of rowLists) {
      for (let index = list.length - 1; index >= 0; index -= 1) if (isAddressRow(list[index] as Unresolved, producer)) list.splice(index, 1);
    }
    const kind = String(producer.meta?.['kind'] ?? 'event');
    const runnersNamed = [...new Set([...granted.values()].flatMap((found) => [...found.functions]))].sort(cmp);
    findings.push({
      service: producer.repo,
      file: producer.file ?? '',
      line: producer.line ?? 0,
      reason: 'channel-from-grant',
      level: 'info',
      message:
        `the call at ${producer.file ?? '?'}:${producer.line ?? '?'} does not say where it sends${before.length === 0 ? '' : `: ${before.join('; ')}`}; ` +
        `${runnersNamed.join(', ')} ${runnersNamed.length === 1 ? 'runs' : 'run'} it and ${runnersNamed.length === 1 ? 'is' : 'are'} granted only ${names.join(', ')}, so it is drawn to each` +
        (open.length === 0 ? '' : `; ${open.map(({ fn, grants, kind: of }) => said(fn, grants, of)).join('; ')}`),
      hint: 'A grant is where the function may send, not where it does: each edge is a guess. Write the address, or one value of the environment the deployment sets, and it is read instead.',
      symbol: producer.id,
      meta: { granted: names, functions: runnersNamed, ...(reasons.length === 0 ? {} : { unread: reasons }) },
    });
    producer.label = `${kind} ${names.join(', ')}`;
    producer.meta = { ...producer.meta, channelVia: 'grant' };
    const starts = producer.meta[STARTS_META];
    if (isDeployedEntryKind(starts)) {
      // Joined by its deployed name with every other reference, later.
      producer.meta = { ...producer.meta, [REACHES_META]: names.map((name) => makeDeployedReference(starts, name)), confidence: 'heuristic' };
      continue;
    }
    for (const name of names) {
      const found = granted.get(name) as Granted;
      const id = makeChannelId(name);
      const adapter = producer.meta['adapter'];
      const existing = nodes.get(id);
      const adapters = [...new Set([...((existing?.meta?.['adapters'] as string[] | undefined) ?? []), ...(typeof adapter === 'string' ? [adapter] : [])])].sort(cmp);
      nodes.set(id, {
        ...(existing ?? { id, type: 'channel', label: name, repo: producer.repo, ...(producer.file === undefined ? {} : { file: producer.file }), ...(producer.line === undefined ? {} : { line: producer.line }) }),
        meta: {
          ...existing?.meta,
          ...(existing?.meta?.['channelKind'] === undefined && producer.meta['channelKind'] !== undefined ? { channelKind: producer.meta['channelKind'] } : {}),
          adapters,
        },
      });
      const edge: GraphEdge = {
        from: producer.id,
        to: id,
        type: 'emits',
        confidence: 'heuristic',
        ...(producer.file === undefined ? {} : { file: producer.file }),
        ...(producer.line === undefined ? {} : { line: producer.line }),
        ...(found.payload === undefined ? {} : { params: [found.payload] }),
        meta: { via: 'grant', grants: [...found.by].sort(cmp), functions: [...found.functions].sort(cmp) },
      };
      edges.set(edgeKey(edge), edge);
    }
  }
  return findings;
};
