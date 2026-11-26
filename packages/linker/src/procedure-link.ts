import { normalizePath, type GraphNode, type Unresolved } from '@flowatlas/core';
import type { FoundValue } from './base-url-value.js';
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
  /**
   * The way in of a service whose key is a pattern the path matches (P277):
   * an MCP resource registered by a URI template, `orders://{id}`, or a tool
   * whose name is written in part, `find{collection}`. Asked only where no key
   * is the path letter for letter.
   */
  matching?(service: string, procedure: string): GraphNode | undefined;
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
  /**
   * The service a request's link sends to, as the address machinery every
   * request is joined by finds it (P242): a setting's claimant, the values the
   * setting is given, the hosts services are reached at. Nothing where the
   * link names no address this can place, and the request is then joined as
   * one with no link is.
   */
  addressOf?(call: GraphNode): ProcedureAddress | undefined;
}

/** Where a link's address goes, as the linker's address reading says (P242). */
export type ProcedureAddress =
  | {
      readonly kind: 'service';
      readonly service: string;
      /** `heuristic` where the service was taken from a value the deployment does not give. */
      readonly confidence: 'static' | 'heuristic';
      /** The value the address was taken from, where a setting's value decided it (P77). */
      readonly baseUrl?: FoundValue;
    }
  | { readonly kind: 'external'; readonly host?: string; readonly baseUrl?: FoundValue }
  /** The address is read and names no service: the row the address machinery gives says why. */
  | {
      readonly kind: 'unplaced';
      readonly finding: Finding;
      /** The values the setting is given that name no service, for the missing-repository survey (P247). */
      readonly values?: readonly string[];
    };

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
export type ProcedureVia = 'same-service' | 'api-target' | 'link-url' | 'grpc-contract';

interface Details {
  linked: {
    via: ProcedureVia;
    entry: GraphNode;
    targetService: string;
    /** The ending the caller asked for, where the entry was declared with another. */
    mismatch?: { asked: string; declared: string };
    /** The link sends to an address no mount of its protocol serves the procedure at (P58). */
    unserved?: { path: string; protocol: string; served: readonly string[] };
    /** Below `static` where the link's service was taken from a value the deployment does not give (P242). */
    confidence?: 'heuristic';
    /** The value the link's address was taken from, where a setting's value decided it (P242). */
    baseUrl?: FoundValue;
  };
  /** The path was not read; the extractor already said where. */
  dynamic: Record<never, never>;
  /** The link sends to a host no configured service is reached at (P242). */
  external: { host?: string; baseUrl?: FoundValue };
  /** The link's address is read and names no service; the address machinery's row says why (P242). */
  unplaced: { finding: Finding; values?: readonly string[] };
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
 *
 * Between the two sits what the client's link says (P58, P242): the service
 * its address names, found by the same reading every request's address gets.
 * A server's client is told where it sends by nothing else, so for a request
 * made between services this is the step that decides.
 */
export const resolveProcedureCall = (call: GraphNode, index: ProcedureIndex): ProcedureOutcome => {
  const procedure = call.meta?.['procedure'];
  const site = call.meta?.['procedureAt'];
  const asked = typeof call.meta?.['call'] === 'string' ? (call.meta['call'] as string) : undefined;
  const link = linkOf(call);
  /** The way in a service declares for the path: by its key, or by a pattern it matches (P277). */
  const declaredBy = (service: string, path: string): GraphNode | undefined =>
    index.proceduresOf(service).get(path) ?? index.matching?.(service, path);

  const linked = (
    entry: GraphNode,
    targetService: string,
    via: ProcedureVia,
    address?: Extract<ProcedureAddress, { kind: 'service' }>,
  ): ProcedureOutcome => {
    const declared = entry.meta?.['call'];
    const unserved = link === undefined ? undefined : unservedBy(link, entry);
    // A name written in part matched by its written parts is a guess; a URI template is how the server matches it (P277).
    const guessed = entry.meta?.['keyPattern'] === 'name-template' && entry.meta?.['key'] !== procedure;
    return {
      kind: 'linked',
      via,
      entry,
      targetService,
      ...(asked !== undefined && typeof declared === 'string' && declared !== asked
        ? { mismatch: { asked, declared } }
        : {}),
      ...(unserved === undefined ? {} : { unserved }),
      ...(address?.confidence === 'heuristic' || guessed ? { confidence: 'heuristic' as const } : {}),
      ...(address?.baseUrl === undefined ? {} : { baseUrl: address.baseUrl }),
    };
  };
  const elsewhereThan = (asking: readonly string[], path: string): string[] =>
    index
      .services()
      .filter((other) => !asking.includes(other) && declaredBy(other, path) !== undefined)
      .sort(cmp);

  // A procedure the caller named by its value, in its own service: the
  // declaration is exact where the path may be relative to a tree below the
  // root (P58).
  if (typeof site === 'string') {
    const declared = index.declaredAt?.(call.repo, site);
    if (declared !== undefined) return linked(declared, call.repo, 'same-service');
  }
  if (typeof procedure !== 'string') return { kind: 'dynamic' };

  const own = declaredBy(call.repo, procedure);
  if (own !== undefined) return linked(own, call.repo, 'same-service');

  // The link's address, placed the way any request's address is (P242): the
  // service it names is asked and no other, a third party is one, and an
  // address that names nobody is said with the row its address would get.
  const address = index.addressOf?.(call);
  if (address?.kind === 'service' && address.service !== call.repo) {
    const entry = declaredBy(address.service, procedure);
    if (entry !== undefined) return linked(entry, address.service, 'link-url', address);
    const asking = [call.repo, address.service];
    return { kind: 'noProcedure', procedure, asked: asking, elsewhere: elsewhereThan(asking, procedure) };
  }
  if (address?.kind === 'external') {
    return { kind: 'external', ...(address.host === undefined ? {} : { host: address.host }), ...(address.baseUrl === undefined ? {} : { baseUrl: address.baseUrl }) };
  }
  if (address?.kind === 'unplaced') {
    return { kind: 'unplaced', finding: address.finding, ...(address.values === undefined ? {} : { values: address.values }) };
  }

  // The link says where it sends, by a settings key the configuration maps to
  // a service; that service is asked and no other (P58).
  const env = link?.baseUrlEnv;
  if (env !== undefined) {
    const named = index.targetOf?.(call.repo, env);
    const claimants = named === undefined ? (index.claimantsOf?.(env) ?? []) : [];
    const service = named ?? (claimants.length === 1 ? claimants[0] : undefined);
    if (service !== undefined && service !== call.repo) {
      const entry = declaredBy(service, procedure);
      if (entry !== undefined) return linked(entry, service, 'link-url');
      const elsewhere = index
        .services()
        .filter((other) => other !== call.repo && other !== service && declaredBy(other, procedure) !== undefined)
        .sort(cmp);
      return { kind: 'noProcedure', procedure, asked: [call.repo, service], elsewhere };
    }
  }

  const targets = [...new Set(index.targetsOf(call.repo))].filter((service) => service !== call.repo).sort(cmp);
  const answering = targets.filter((service) => declaredBy(service, procedure) !== undefined);
  const [only] = answering;
  if (answering.length === 1 && only !== undefined) {
    return linked(declaredBy(only, procedure) as GraphNode, only, 'api-target');
  }
  if (answering.length > 1) return { kind: 'ambiguous', procedure, candidates: answering };

  // A gRPC method is named in full - its package, its service, its method -
  // by a contract both ends share, which is a namespace and not a word two
  // trees happen to use. Sent where nothing here can read (a client a
  // package injects, a name a registry resolves), it reaches the one
  // configured service that implements it, as sure as a guess (P274).
  if (procedure.startsWith('grpc:') && address === undefined) {
    const implementing = index.services().filter((service) => service !== call.repo && index.proceduresOf(service).has(procedure));
    const [sole] = implementing;
    if (implementing.length === 1 && sole !== undefined) {
      return { ...linked(index.proceduresOf(sole).get(procedure) as GraphNode, sole, 'grpc-contract'), confidence: 'heuristic' } as ProcedureOutcome;
    }
    if (implementing.length > 1) return { kind: 'ambiguous', procedure, candidates: implementing.sort(cmp) };
  }

  const asking = [call.repo, ...targets];
  const elsewhere = index
    .services()
    .filter((service) => !asking.includes(service) && declaredBy(service, procedure) !== undefined)
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
  external: null,
  unplaced: ({ finding }) => finding,
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

/**
 * The gRPC services a service calls that its contract declares and nothing
 * configured implements (P274), one row per caller and service.
 *
 * A call of a method of `shop.CartService` carries the `.proto` file the
 * caller found it in. Where no configured service implements the method -
 * read from its code or declared by that file - the call joins nothing, and
 * the address it is sent to says so on its own row. What the address cannot
 * say is that the method is a real one, declared by a contract the
 * repository holds: the service that answers it is written in another
 * language, or is not configured. That is this row, once per service the
 * caller calls, naming the methods and the file, so the fix - a service
 * declared by that file, or the repository that implements it - is one entry.
 */
export const unservedContracts = (calls: readonly GraphNode[], index: Pick<ProcedureIndex, 'services' | 'proceduresOf'>): Unresolved[] => {
  const implemented = (procedure: string): boolean => index.services().some((service) => index.proceduresOf(service).has(procedure));
  const groups = new Map<string, { first: GraphNode; service: string; contract: string; methods: Set<string>; sites: number }>();
  for (const call of calls) {
    const procedure = call.meta?.['procedure'];
    const contract = call.meta?.['contract'];
    const service = call.meta?.['service'];
    const method = call.meta?.['method'];
    if (typeof procedure !== 'string' || !procedure.startsWith('grpc:') || typeof contract !== 'string' || typeof service !== 'string' || typeof method !== 'string') continue;
    if (implemented(procedure)) continue;
    const key = `${call.repo}\0${service}`;
    const group = groups.get(key) ?? { first: call, service, contract, methods: new Set<string>(), sites: 0 };
    group.methods.add(method);
    group.sites += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => cmp(`${a.first.repo}\0${a.service}`, `${b.first.repo}\0${b.service}`))
    .map(({ first, service, contract, methods, sites }) => ({
      service: first.repo,
      file: first.file ?? '',
      line: first.line ?? 0,
      reason: 'grpc-method-unserved',
      ...(sites > 1 ? { sites } : {}),
      message: `${first.repo} calls ${service} (${[...methods].sort(cmp).join(', ')}), which ${contract} declares and no configured service implements`,
      hint: `The service that answers it is not read here: written in another language, or not configured. Declare it by that file - a service with "document": { "kind": "protobuf", "path": ..., "services": ["${service}"] } - or add the repository that implements it to services[].`,
      symbol: first.id,
      meta: { grpcService: service, contract, methods: [...methods].sort(cmp) },
    }));
};
