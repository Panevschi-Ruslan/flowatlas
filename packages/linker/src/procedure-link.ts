import { normalizePath, type GraphNode } from '@flowatlas/core';
import type { Finding } from './http-link.js';
import { cmp } from './order.js';

/**
 * What the linker can be asked while resolving one request for a procedure.
 *
 * Passed in rather than reached for, as its two neighbours are, so the decision
 * is a question about these lookups and can be asked in a test with no project
 * behind it.
 */
export interface ProcedureIndex {
  /** The procedures a service declares, by path. Empty when it declares none. */
  proceduresOf(service: string): ReadonlyMap<string, GraphNode>;
  /** The services a caller's service is configured to call. */
  targetsOf(service: string): readonly string[];
  /** Every service declaring a procedure, for saying where else one lives. */
  services(): readonly string[];
  /** The procedure a service declares at a file and line, `src/orders.ts:12` (P58). */
  declaredAt?(service: string, site: string): GraphNode | undefined;
  /** The service a caller's settings key names in its `apiTarget` (P58). */
  targetOf?(service: string, env: string): string | undefined;
  /** The services that claim a settings key as their own base (P58). */
  claimantsOf?(env: string): readonly string[];
}

/**
 * Whether an entry is a procedure, by what it says about itself.
 *
 * A way in named by a path and opened by a chain ending: `meta.key` is the path
 * and `meta.call` is the ending. Both, because each alone is carried by
 * something else — a message pattern has a key of sorts and no ending, and a
 * server action has neither — and a request for `orders.list` must never be
 * joined to a message handler that happens to listen on the same string.
 */
export const isProcedureEntry = (node: GraphNode): boolean =>
  node.type === 'entry' &&
  typeof node.meta?.['key'] === 'string' &&
  typeof node.meta?.['call'] === 'string';

/**
 * How the service on the other end was decided.
 *
 * `link-url` is the settings key the client's link sends to, named by the
 * caller's `apiTarget` or claimed by one service as its base (P58): the one
 * place a client of this family says where it sends.
 */
export type ProcedureVia = 'same-service' | 'api-target' | 'link-url';

interface Details {
  linked: {
    via: ProcedureVia;
    entry: GraphNode;
    targetService: string;
    /** The ending the caller asked for, where the entry was declared with another. */
    mismatch?: { asked: string; declared: string };
    /** The link sends to an address no mount of its protocol serves the procedure at (P58). */
    unserved?: { path: string; protocol: string; served: readonly string[] };
  };
  /** The path was not read; the extractor already said where. */
  dynamic: Record<never, never>;
  /** Nothing the caller may reach declares it. */
  noProcedure: {
    procedure: string;
    asked: readonly string[];
    /** Services that do declare it and that nothing says this caller reaches. */
    elsewhere: readonly string[];
  };
  /** More than one of the services the caller is configured to call declares it. */
  ambiguous: { procedure: string; candidates: readonly string[] };
}

export type ProcedureOutcomeKind = keyof Details;

export type ProcedureOutcome = {
  [K in ProcedureOutcomeKind]: { kind: K } & Details[K];
}[ProcedureOutcomeKind];

/**
 * Decides which procedure a request for one reaches.
 *
 * Two places are asked, in order, and nothing else. The caller's own service
 * first, which is what a client in the same repository as its tree means and is
 * the commonest shape there is. Then the services the caller's configuration
 * says it calls — the values of its `apiTarget` — because that is the one line a
 * project writes to say which backend a front end talks to, and a procedure path
 * carries no host or settings key of its own to say it instead.
 *
 * There is deliberately no third way, no search of every service for one that
 * happens to declare the path. A route search can fall back on that because a
 * URL is long and specific; `user.get` is declared by half the trees ever written,
 * and a join made on a coincidence would be an edge between two services that
 * never speak. Where some unconfigured service does declare the path, the
 * finding names it, so the fix is one line of configuration away rather than an
 * edge the tool made up.
 */
export const resolveProcedureCall = (call: GraphNode, index: ProcedureIndex): ProcedureOutcome => {
  const procedure = call.meta?.['procedure'];
  const site = call.meta?.['procedureAt'];
  const asked = typeof call.meta?.['call'] === 'string' ? (call.meta['call'] as string) : undefined;
  const link = linkOf(call);

  const linked = (entry: GraphNode, targetService: string, via: ProcedureVia): ProcedureOutcome => {
    const declared = entry.meta?.['call'];
    const unserved = link === undefined ? undefined : unservedBy(link, entry);
    return {
      kind: 'linked',
      via,
      entry,
      targetService,
      ...(asked !== undefined && typeof declared === 'string' && declared !== asked
        ? { mismatch: { asked, declared } }
        : {}),
      ...(unserved === undefined ? {} : { unserved }),
    };
  };

  // A procedure the caller named by its value, in its own service: the
  // declaration is exact where the path may be relative to a tree below the
  // root (P58).
  if (typeof site === 'string') {
    const declared = index.declaredAt?.(call.repo, site);
    if (declared !== undefined) return linked(declared, call.repo, 'same-service');
  }
  if (typeof procedure !== 'string') return { kind: 'dynamic' };

  const own = index.proceduresOf(call.repo).get(procedure);
  if (own !== undefined) return linked(own, call.repo, 'same-service');

  // The link says where it sends, by a settings key the configuration maps to
  // a service; that service is asked and no other (P58).
  const env = link?.baseUrlEnv;
  if (env !== undefined) {
    const named = index.targetOf?.(call.repo, env);
    const claimants = named === undefined ? (index.claimantsOf?.(env) ?? []) : [];
    const service = named ?? (claimants.length === 1 ? claimants[0] : undefined);
    if (service !== undefined && service !== call.repo) {
      const entry = index.proceduresOf(service).get(procedure);
      if (entry !== undefined) return linked(entry, service, 'link-url');
      const elsewhere = index
        .services()
        .filter((other) => other !== call.repo && other !== service && index.proceduresOf(other).has(procedure))
        .sort(cmp);
      return { kind: 'noProcedure', procedure, asked: [call.repo, service], elsewhere };
    }
  }

  const targets = [...new Set(index.targetsOf(call.repo))].filter((service) => service !== call.repo).sort(cmp);
  const answering = targets.filter((service) => index.proceduresOf(service).has(procedure));
  const [only] = answering;
  if (answering.length === 1 && only !== undefined) {
    return linked(index.proceduresOf(only).get(procedure) as GraphNode, only, 'api-target');
  }
  if (answering.length > 1) return { kind: 'ambiguous', procedure, candidates: answering };

  const asking = [call.repo, ...targets];
  const elsewhere = index
    .services()
    .filter((service) => !asking.includes(service) && index.proceduresOf(service).has(procedure))
    .sort(cmp);
  return { kind: 'noProcedure', procedure, asked: asking, elsewhere };
};

/** What a request's link says about where it sends (P58). */
interface Link {
  protocol?: string;
  path?: string;
  baseUrlEnv?: string;
}

const linkOf = (call: GraphNode): Link | undefined => {
  const link = call.meta?.['link'];
  if (link === null || typeof link !== 'object') return undefined;
  const { protocol, path, baseUrlEnv } = link as Record<string, unknown>;
  return {
    ...(typeof protocol === 'string' ? { protocol } : {}),
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof baseUrlEnv === 'string' ? { baseUrlEnv } : {}),
  };
};

/**
 * The address a link sends to, where the entry says it is mounted with the
 * link's protocol and never at that address (P58). Nothing where either side
 * did not say: an entry with no mount of that protocol read is not a finding.
 */
const unservedBy = (link: Link, entry: GraphNode): { path: string; protocol: string; served: readonly string[] } | undefined => {
  if (link.path === undefined || link.protocol === undefined) return undefined;
  const mounted = entry.meta?.['mounted'];
  if (!Array.isArray(mounted)) return undefined;
  const served = mounted
    .filter((mount): mount is { protocol: string; prefix: string } =>
      mount !== null && typeof mount === 'object' && mount.protocol === link.protocol && typeof mount.prefix === 'string')
    .map((mount) => normalizePath(mount.prefix));
  if (served.length === 0) return undefined;
  const path = normalizePath(link.path);
  return served.includes(path) ? undefined : { path, protocol: link.protocol, served: [...new Set(served)].sort(cmp) };
};

/** What each outcome means to whoever reads the report. */
const FINDINGS: {
  [K in ProcedureOutcomeKind]: ((detail: Details[K], call: GraphNode) => Finding | undefined) | null;
} = {
  linked: ({ mismatch, unserved, entry }) =>
    mismatch !== undefined
      ? {
          reason: 'procedure-call-mismatch',
          message: `${String(entry.meta?.['key'])} is asked for as a ${mismatch.asked} and declared as a ${mismatch.declared}`,
          hint: `The two are sent differently and the server refuses the one it did not declare. Call it as a ${mismatch.declared}, or declare it as a ${mismatch.asked}.`,
        }
      : unserved !== undefined
        ? {
            reason: 'procedure-link-unserved',
            message: `${String(entry.meta?.['key'])} is sent to ${unserved.path} and served over ${unserved.protocol} at ${unserved.served.join(' and ')}`,
            hint: `Nothing answers a request sent there. Point the link at ${unserved.served.join(' or ')}, or mount the tree where the link sends.`,
          }
        : undefined,
  dynamic: null,
  noProcedure: ({ procedure, asked, elsewhere }, call) => ({
    reason: 'procedure-not-found',
    message: `no procedure ${procedure} in ${asked.join(' or ')}`,
    hint:
      elsewhere.length === 0
        ? 'Renamed or removed? Check the tree this client is typed from, or add the service that declares it to services[] and name it in apiTarget.'
        : `${elsewhere.join(' and ')} ${elsewhere.length === 1 ? 'declares' : 'declare'} it, and nothing says ${call.repo} calls ${elsewhere.length === 1 ? 'it' : 'them'}. If it does, name it in services[].apiTarget of ${call.repo}.`,
  }),
  ambiguous: ({ procedure, candidates }) => ({
    reason: 'procedure-ambiguous',
    message: `${candidates.join(' and ')} both declare ${procedure}`,
    hint: 'Leave only the service this client talks to in its apiTarget.',
  }),
};

/** The finding an outcome carries, or nothing when the request resolved cleanly. */
export const procedureFindingFor = (outcome: ProcedureOutcome, call: GraphNode): Finding | undefined => {
  const describe = FINDINGS[outcome.kind] as
    | ((detail: ProcedureOutcome, call: GraphNode) => Finding | undefined)
    | null;
  return describe === null ? undefined : describe(outcome, call);
};

/** The reason an unresolved request counts under, whether or not it produced a row. */
export const procedureReasonOf = (outcome: ProcedureOutcome, call: GraphNode): string | undefined =>
  outcome.kind === 'dynamic' ? 'procedure-path-dynamic' : procedureFindingFor(outcome, call)?.reason;
