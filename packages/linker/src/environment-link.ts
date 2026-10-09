import {
  AWAITING_META,
  CONFIDENCE_RANK,
  ENVIRONMENT_META,
  isDeployedEntryKind,
  makeChannelId,
  makeDeployedReference,
  nameWithin,
  REACHES_META,
  STARTS_META,
  type AwaitedAddress,
  type Confidence,
  type EnvironmentValue,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Completes what code addresses by a value of its environment, from the values
 * the deployment gives the functions that run that code (P23).
 *
 * Code very often says where it sends by reading a variable -
 * `QueueUrl: process.env.RETURNS_QUEUE_URL` - and the value is set where the
 * function is deployed. The extractor keeps such an address on its publisher
 * with the variable standing in for the part it could not read
 * (`meta.awaiting`), and keeps on each deployed function's entry the values
 * that function is deployed with (`meta.environment`). Which function runs
 * which code is the call graph's to say, and the call graph is only whole once
 * every reader has drawn its part, which is why this is done here.
 *
 * The question is asked per function, because two functions may run the same
 * helper and set the same variable to two different queues; the helper then
 * sends to both, each edge saying for which function. A function that runs the
 * code and does not set the variable is a row naming both, and so is one that
 * sets it to something the files do not settle. A settings key a function sets
 * is told where its value comes from on the edge that reads it.
 */

/** The edges code is reached along from a function's entry. */
const REACH = new Set(['handles', 'calls']);

/** Every node each deployed function reaches, within its own service. */
const reachedBy = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
  functions: readonly GraphNode[],
): Map<string, GraphNode[]> => {
  const out = new Map<string, GraphEdge[]>();
  for (const edge of edges.values()) {
    if (!REACH.has(edge.type)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  }
  const reached = new Map<string, GraphNode[]>();
  for (const fn of functions) {
    const seen = new Set<string>([fn.id]);
    const queue = [fn.id];
    for (let next = 0; next < queue.length; next += 1) {
      const at = queue[next] as string;
      for (const edge of out.get(at) ?? []) {
        const node = nodes.get(edge.to);
        // Another way in is another function's business, or nobody's.
        if (node === undefined || seen.has(node.id) || node.type === 'entry' || node.repo !== fn.repo) continue;
        seen.add(node.id);
        reached.set(node.id, [...(reached.get(node.id) ?? []), fn]);
        queue.push(node.id);
      }
    }
  }
  return reached;
};

const environmentOf = (fn: GraphNode): Readonly<Record<string, EnvironmentValue>> =>
  (fn.meta?.[ENVIRONMENT_META] as Record<string, EnvironmentValue> | undefined) ?? {};

const isConfidence = (value: unknown): value is Confidence => typeof value === 'string' && value in CONFIDENCE_RANK;

/** The rows a reader writes for an address that waits on the environment, which a completion answers. */
const WAITING = new Set(['channel-from-environment', 'start-from-environment']);

/** The call a publisher is, as a reader finds it in the file. */
const callAt = (producer: GraphNode): string => `the call at ${producer.file ?? '?'}:${producer.line ?? '?'}`;

/** What one function makes of one address: the channel's name, or what stopped it. */
/**
 * What one function makes of one address: the channel's name, with the
 * variables the deployment set and those it left to the code's own fallback
 * (`defaults`), or what stopped it.
 */
type Completion =
  | { readonly name: string; readonly variables: readonly string[]; readonly defaults: readonly string[] }
  | { readonly missing: string }
  | { readonly unread: string; readonly value: EnvironmentValue };

/**
 * A variable the function is deployed with decides its part; one it is not
 * deployed with is the code's fallback where the code wrote one (R175), and
 * stops the address where it did not. A value the deployment sets and the files
 * do not settle stops it either way: the fallback is not what runs there.
 */
const complete = (address: AwaitedAddress, environment: Readonly<Record<string, EnvironmentValue>>): Completion => {
  const parts: string[] = [];
  const variables: string[] = [];
  const defaults: string[] = [];
  for (const part of address.parts) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    const value = environment[part.environment];
    if (value === undefined) {
      if (part.otherwise === undefined) return { missing: part.environment };
      parts.push(part.otherwise);
      defaults.push(part.environment);
      continue;
    }
    if (value.value === undefined) return { unread: part.environment, value };
    parts.push(value.kind === undefined ? nameWithin(value.value, part.forms) : value.value);
    variables.push(part.environment);
  }
  return { name: parts.join('/'), variables, defaults };
};

/** One channel an address reached, and for whom: the functions, the variables they set, and those left to the code's fallback. */
interface Reached {
  readonly functions: Set<string>;
  readonly variables: Set<string>;
  readonly defaults: Set<string>;
  readonly payload?: string;
}

const at = (node: GraphNode): Pick<Unresolved, 'service' | 'file' | 'line'> => ({
  service: node.repo,
  file: node.file ?? '',
  line: node.line ?? 0,
});

/** Completes every awaiting address it can, in place, and returns the rows for what it could not. */
export const completeFromEnvironment = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  rows: Unresolved[],
): Unresolved[] => {
  const functions = [...nodes.values()]
    .filter((node) => node.type === 'entry' && node.meta?.[ENVIRONMENT_META] !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  if (functions.length === 0) return [];
  const reached = reachedBy(nodes, edges, functions);
  const findings: Unresolved[] = [];
  const callsInto = new Map<string, GraphEdge[]>();
  for (const edge of edges.values()) {
    if (edge.type === 'calls') callsInto.set(edge.to, [...(callsInto.get(edge.to) ?? []), edge]);
  }

  const producers = [...nodes.values()]
    .filter((node) => Array.isArray(node.meta?.[AWAITING_META]) && reached.has(node.id))
    .sort((a, b) => cmp(a.id, b.id));
  for (const producer of producers) {
    const runners = reached.get(producer.id) as GraphNode[];
    const addresses = producer.meta?.[AWAITING_META] as AwaitedAddress[];
    // How far the call can be trusted, as the reader of the call said; its edge
    // was drawn weak only because there was no channel yet to put it on.
    const stated = producer.meta?.['confidence'];
    const calledAt: Confidence = isConfidence(stated) ? stated : 'static';
    // A start's address names the entry it starts, not a channel (P24).
    const starts = producer.meta?.[STARTS_META];
    const said = isDeployedEntryKind(starts) ? { verb: 'starts', what: 'what it starts' } : { verb: 'sends to', what: 'where it sends' };
    const reachedChannels = new Map<string, Reached>();
    const reported = new Set<string>();
    for (const address of addresses) {
      for (const fn of runners) {
        const done = complete(address, environmentOf(fn));
        if ('name' in done) {
          const found: Reached = reachedChannels.get(done.name) ?? { functions: new Set(), variables: new Set(), defaults: new Set(), ...(address.payload === undefined ? {} : { payload: address.payload }) };
          found.functions.add(fn.label);
          for (const variable of done.variables) found.variables.add(variable);
          for (const variable of done.defaults) found.defaults.add(variable);
          reachedChannels.set(done.name, found);
          continue;
        }
        const variable = 'missing' in done ? done.missing : done.unread;
        const key = `${fn.id}\0${variable}`;
        if (reported.has(key)) continue;
        reported.add(key);
        findings.push(
          'missing' in done
            ? {
                ...at(producer),
                reason: 'environment-not-set',
                message: `${callAt(producer)} ${said.verb} the value of ${variable}; ${fn.label} runs it and is not deployed with ${variable}, so ${said.what} from there is not known`,
                hint: `Set ${variable} in the environment ${fn.label} is deployed with, or correct the name the code reads.`,
                symbol: producer.id,
                meta: { function: fn.id, variable },
              }
            : {
                ...at(producer),
                reason: 'environment-value-unread',
                message: `${callAt(producer)} ${said.verb} the value of ${variable}, which ${fn.label} is deployed with as ${done.value.written}, and that is not read: ${done.value.unread ?? 'it is not known from the files'}`,
                hint:
                  done.value.files !== undefined
                    ? `The variable files set it differently (${Object.keys(done.value.files).join(', ')}). Choose the environment to read under services[].infra.vars.`
                    : done.value.variable !== undefined
                      ? `Give var.${done.value.variable} a value the files settle: a default, or a variable file.`
                      : 'Write the value so the files settle it: a literal, or a reference to the queue, topic or bus the deployment declares.',
                symbol: producer.id,
                meta: { function: fn.id, variable, ...(done.value.files === undefined ? {} : { files: done.value.files }) },
              },
        );
      }
    }
    // The row the extractor wrote said nothing was known about where this
    // sends; a function runs it, so the rows above say exactly what is.
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index] as Unresolved;
      if (WAITING.has(row.reason) && row.service === producer.repo && row.file === producer.file && row.line === producer.line) {
        rows.splice(index, 1);
      }
    }
    if (reachedChannels.size === 0) continue;
    const kind = String(producer.meta?.['kind'] ?? 'event');
    const names = [...reachedChannels.keys()].sort(cmp);
    producer.label = `${kind} ${names.join(', ')}`;
    producer.meta = { ...producer.meta, channelVia: 'environment' };
    for (const edge of callsInto.get(producer.id) ?? []) edge.confidence = calledAt;
    if (isDeployedEntryKind(starts)) {
      // Joined by its deployed name with every other reference, later.
      const reaches = (producer.meta[REACHES_META] as string[] | undefined) ?? [];
      producer.meta = { ...producer.meta, [REACHES_META]: [...new Set([...reaches, ...names.map((name) => makeDeployedReference(starts, name))])] };
      continue;
    }
    for (const name of names) {
      const found = reachedChannels.get(name) as Reached;
      const id = makeChannelId(name);
      const adapter = producer.meta?.['adapter'];
      const existing = nodes.get(id);
      const adapters = [...new Set([...((existing?.meta?.['adapters'] as string[] | undefined) ?? []), ...(typeof adapter === 'string' ? [adapter] : [])])].sort(cmp);
      nodes.set(id, {
        ...(existing ?? { id, type: 'channel', label: name, repo: producer.repo, ...(producer.file === undefined ? {} : { file: producer.file }), ...(producer.line === undefined ? {} : { line: producer.line }) }),
        meta: {
          ...existing?.meta,
          ...(existing?.meta?.['channelKind'] === undefined && producer.meta?.['channelKind'] !== undefined ? { channelKind: producer.meta['channelKind'] } : {}),
          adapters,
        },
      });
      const edge: GraphEdge = {
        from: producer.id,
        to: id,
        type: 'emits',
        confidence: calledAt,
        ...(producer.file === undefined ? {} : { file: producer.file }),
        ...(producer.line === undefined ? {} : { line: producer.line }),
        ...(found.payload === undefined ? {} : { params: [found.payload] }),
        meta: {
          via: 'environment',
          variables: [...found.variables].sort(cmp),
          ...(found.defaults.size === 0 ? {} : { defaults: [...found.defaults].sort(cmp) }),
          functions: [...found.functions].sort(cmp),
        },
      };
      edges.set(edgeKey(edge), edge);
    }
  }

  // Where the value of a settings key comes from, for every function that sets it.
  for (const edge of edges.values()) {
    if (edge.type !== 'reads_config') continue;
    const key = nodes.get(edge.to)?.meta?.['key'];
    const runners = reached.get(edge.from) ?? [];
    if (typeof key !== 'string' || runners.length === 0) continue;
    const setBy = runners.flatMap((fn) => {
      const value = environmentOf(fn)[key];
      return value === undefined ? [] : [{ function: fn.label, written: value.written, ...(value.value === undefined ? {} : { value: value.value }) }];
    });
    if (setBy.length > 0) edge.meta = { ...edge.meta, setBy: setBy.sort((a, b) => cmp(a.function, b.function)) };
  }
  return findings;
};
