/**
 * The ways a client asks for a procedure by its path, described rather than
 * implemented.
 *
 * The other half of `procedure-dialects.ts` in the entry adapters, and shaped
 * after it for the same reason: a tree of procedures names a way in by the keys
 * above it, and a client of that tree names it by the same keys, written as
 * property accesses on a proxy — `trpc.orders.list.useQuery(input)`. There is no
 * URL anywhere in that sentence, so nothing in `clients.ts` can describe it: every
 * row there answers "which argument is the address", and here the address is the
 * receiver.
 *
 * So a description of its own and one reader over it. What stayed in the reader
 * is only what is true of every such client: that a chain of names hangs off a
 * value some factory made, that the names between the value and the last link
 * are the path, and that the last link decides what the call does. What is in
 * the row is every name: which factories make a proxy, which trailing methods end
 * a chain and what each one does on the other side.
 */

/** One trailing method, and what it asks the procedure to do. */
export interface ProcedureOperation {
  /**
   * The ending the server wrote the procedure with, which this reaches.
   *
   * The server's own spelling (`query`, `mutation`, `subscription`), because the
   * join compares the two literally: a request whose word differs from the
   * entry's is a call the server refuses, and the linker says so without
   * knowing what either word means.
   */
  readonly call: string;
  /** The argument holding the input, when this spelling takes it at the call. */
  readonly inputAt?: number;
  /**
   * The key of that argument holding the input, where the argument is an
   * options object rather than the input itself: `queryOptions({ input })` (P58).
   */
  readonly inputKey?: string;
}

/**
 * Where a client is told the address it sends to (P58): a link built with
 * `new`, handed to the factory that made the proxy, whose options carry the URL.
 */
export interface ProcedureLink {
  /** The class built: `RPCLink`. */
  readonly name: string;
  /** The protocol it speaks, as a server's mount names it in `meta.mounted`. */
  readonly protocol: string;
  /** The argument of the constructor holding the options. */
  readonly optionsAt: number;
  /** The key of the options holding the URL. */
  readonly urlKey: string;
}

/**
 * A function handed a procedure by its value rather than asked for one by its
 * path (P58): `call(router.orders.list, input)`.
 */
export interface ProcedureCaller {
  readonly name: string;
  /** The argument holding the procedure. */
  readonly procedureAt: number;
  /** The argument holding the input. */
  readonly inputAt: number;
  /** What the server must have ended the procedure with. */
  readonly call: string;
}

export interface ProcedureClient {
  /** How the client is named in `meta.client` and in every row. */
  readonly name: string;
  /** Dependencies any one of which means this client may be in use. */
  readonly packages: readonly string[];
  /**
   * Functions whose result is the root of a proxy.
   *
   * Names rather than types, and for the reason the server row gives: the
   * reading has to work in a clone nobody installed, where the proxy's type is
   * `any`. The looseness is bounded twice. The repository has to depend on one
   * of `packages`, and a value is a proxy only when it was made by a call to one
   * of these, so an object literal with an `orders.list.query` in it is never
   * one.
   */
  readonly proxies: readonly string[];
  /** How the names down the proxy are joined into one path. */
  readonly separator: string;
  /** The last link of a chain, and what it asks for. */
  readonly operations: Readonly<Record<string, ProcedureOperation>>;
  /**
   * Proxies whose path is itself called - `client.orders.list(input)` - and
   * what that asks for (P58). A proxy of the others only ends in an operation.
   */
  readonly direct?: { readonly proxies: readonly string[]; readonly operation: ProcedureOperation };
  /**
   * Proxies made from the tree itself, in the process that serves it, whose
   * first argument is the tree (P58): a request that never leaves the service.
   */
  readonly inProcess?: readonly string[];
  /** The links a proxy factory may be handed, where the address is written (P58). */
  readonly links?: readonly ProcedureLink[];
  /** Functions handed a procedure by its value (P58). */
  readonly callers?: readonly ProcedureCaller[];
}

const QUERY: ProcedureOperation = { call: 'query', inputAt: 0 };
const MUTATION_NOW: ProcedureOperation = { call: 'mutation', inputAt: 0 };
/** A mutation whose input is handed over later, to what the hook returns. */
const MUTATION_LATER: ProcedureOperation = { call: 'mutation' };
const SUBSCRIPTION: ProcedureOperation = { call: 'subscription', inputAt: 0 };

/**
 * tRPC, whose client this was written to fit.
 *
 * Four packages and one shape. The plain client ends a chain with `query`,
 * `mutate` or `subscribe`; the React bindings end it with a hook; the newer
 * TanStack bindings end it with an options factory handed to the query library;
 * the server-side helpers end it with `fetch` or `prefetch`. Every one of them is
 * a path of names and an ending, which is why they are one row.
 *
 * `useUtils` makes a proxy too, and only its request-making endings are listed:
 * `invalidate`, `setData` and the rest act on a cache and ask the server nothing,
 * so an edge from them to a way in would be a request nobody makes.
 *
 * Left out on purpose: `useContext`, the older name of `useUtils`, because it is
 * also React's own hook and a name that means two things cannot be a marker of
 * either; and a server-side caller (`router.createCaller(ctx)`), whose chain ends
 * in the procedure itself being called with no trailing method at all.
 */
export const TRPC_CLIENT: ProcedureClient = {
  name: 'trpc-client',
  packages: [
    '@trpc/client',
    '@trpc/react-query',
    '@trpc/next',
    '@trpc/tanstack-react-query',
  ],
  proxies: [
    'createTRPCClient',
    'createTRPCProxyClient',
    'createTRPCReact',
    'createTRPCNext',
    'createServerSideHelpers',
    'useTRPC',
    'useTRPCClient',
    'useUtils',
  ],
  separator: '.',
  operations: {
    query: QUERY,
    mutate: MUTATION_NOW,
    subscribe: SUBSCRIPTION,
    useQuery: QUERY,
    useSuspenseQuery: QUERY,
    useInfiniteQuery: QUERY,
    useSuspenseInfiniteQuery: QUERY,
    usePrefetchQuery: QUERY,
    usePrefetchInfiniteQuery: QUERY,
    useMutation: MUTATION_LATER,
    useSubscription: SUBSCRIPTION,
    queryOptions: QUERY,
    infiniteQueryOptions: QUERY,
    mutationOptions: MUTATION_LATER,
    subscriptionOptions: SUBSCRIPTION,
    fetch: QUERY,
    prefetch: QUERY,
    fetchInfinite: QUERY,
    prefetchInfinite: QUERY,
    ensureData: QUERY,
  },
};

/** What every oRPC request asks for: the one ending its server writes (P58). */
const HANDLER: ProcedureOperation = { call: 'handler', inputAt: 0 };
/** The same, with the input under `input` in the options the call is handed. */
const HANDLER_OPTIONS: ProcedureOperation = { call: 'handler', inputAt: 0, inputKey: 'input' };

/**
 * oRPC, the second of the family (P58).
 *
 * A client is a proxy whose path is called - `client.orders.list(input)` - and
 * the query bindings wrap one in a proxy of their own whose path ends in an
 * options factory, `orpc.orders.list.queryOptions({ input })`, with the input
 * under a key. The server does not declare a query or a mutation, so every
 * request asks for `handler`, the one ending a server writes.
 *
 * The client says where it sends in the link it was made with, `new
 * RPCLink({ url })`, so the address is read there and the linker can pick the
 * service the URL's settings key names. `createRouterClient(router)` and
 * `call(procedure, input)` are the server calling its own procedures in
 * process; `key`, `queryKey` and `mutationKey` read a cache and ask nothing.
 */
export const ORPC_CLIENT: ProcedureClient = {
  name: 'orpc-client',
  packages: [
    '@orpc/client',
    '@orpc/tanstack-query',
    '@orpc/react-query',
    '@orpc/vue-query',
    '@orpc/solid-query',
    '@orpc/svelte-query',
    '@orpc/server',
  ],
  proxies: [
    'createORPCClient',
    'createRouterClient',
    'createTanstackQueryUtils',
    'createORPCReactQueryUtils',
    'createORPCVueQueryUtils',
    'createORPCSolidQueryUtils',
    'createORPCSvelteQueryUtils',
  ],
  separator: '.',
  operations: {
    queryOptions: HANDLER_OPTIONS,
    infiniteOptions: HANDLER_OPTIONS,
    mutationOptions: HANDLER,
    streamedOptions: HANDLER_OPTIONS,
    liveOptions: HANDLER_OPTIONS,
    experimental_streamedOptions: HANDLER_OPTIONS,
    experimental_liveOptions: HANDLER_OPTIONS,
    call: HANDLER,
  },
  direct: { proxies: ['createORPCClient', 'createRouterClient'], operation: HANDLER },
  inProcess: ['createRouterClient'],
  links: [
    { name: 'RPCLink', protocol: 'rpc', optionsAt: 0, urlKey: 'url' },
    { name: 'OpenAPILink', protocol: 'openapi', optionsAt: 1, urlKey: 'url' },
  ],
  callers: [{ name: 'call', procedureAt: 0, inputAt: 1, call: 'handler' }],
};

/** Every client this extractor reads a procedure path from. */
export const PROCEDURE_CLIENTS: readonly ProcedureClient[] = [TRPC_CLIENT, ORPC_CLIENT];
