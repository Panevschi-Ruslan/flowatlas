/**
 * What an unresolved row is about, apart from how much it matters.
 *
 * The list of unresolved rows holds three different things, and every figure
 * the tool prints about its own reading has to tell them apart, or a number
 * meant to say "this much was missed" ends up counting joins that were made:
 *
 * - **gap** — the reader could not follow something. A receiver with no single
 *   class (`call-dynamic-receiver`), a type the checker could not resolve
 *   (`type-unresolved`), a base address read from a setting nobody claims
 *   (`unknown-base-url-env`), a variable a deployment does not set
 *   (`environment-not-set`). Something is missing from the graph, and these are
 *   the only rows counted as missed.
 * - **note** — how a join or a reading was made, with nothing missed. A base
 *   address taken from a repository's own files (`base-url-from-files`) or from
 *   a setting's name (`base-url-from-name`), a package read from its source in
 *   place of an install (`package-from-repo`), a shape file a stronger source
 *   made unnecessary (`shape-file-unmatched`), a route that checks who is asking
 *   in its own body (`route-checked-in-body`). The edge is there; the row says
 *   how much to trust it.
 * - **finding** — something about the code itself, which holds whatever the
 *   reader managed: a query run once per item of a loop (`query-in-loop`), a
 *   route with nothing in front of it that reaches stored data
 *   (`route-unguarded`), a worker answering before the application
 *   (`route-shadowed`). A reviewer acts on these; a better reader would not
 *   make them go away.
 *
 * The kind is derived from the reason and what the row recorded, here and
 * nowhere else. The graph database stores it on each row when the graph is
 * written (P208), with a finding's risk, so a reader reads one stored answer
 * (`rowKindOf`, `rowRiskOf`); a row with none stored - an older database, the
 * JSON graph, a row made at read time - is decided here as it always was, so
 * the answer is the same either way. Kind and level are orthogonal. Level is how much a row matters
 * (`action`, `info`, `nothing`); kind is what it is about. A note can be `info`,
 * a finding can be `action` (`route-unguarded` where a guard is expected) or
 * `info` (`query-in-loop`). Level `nothing` keeps the one meaning it has: a
 * place where no edge exists to draw.
 *
 * A reason no entry names is a gap, which is the safe reading: a row nobody
 * classified is counted as missed rather than quietly left out of a total.
 * `scripts/check-doctor-reasons.mjs` fails on a reason `doctor` knows that has
 * no explicit kind here, so the default is only ever met by a reason from a
 * newer tool or a test.
 */

/** The kinds, in the order a reader is shown them. */
export const ROW_KIND_NAMES = ['gap', 'note', 'finding'] as const;

/** What a row is about: something not followed, how something was joined, or the code itself. */
export type RowKind = (typeof ROW_KIND_NAMES)[number];

/** The rows a kind is decided from: a reason, and what the row recorded beside it. */
export interface KindedRow {
  reason: string;
  meta?: Record<string, unknown> | null;
}

// How a join or a reading was made. Every one of these sits beside an edge
// that was drawn, or a package that was read.
const NOTES: readonly string[] = [
  // A call of a framework module that the options it is handed rule out (P255)
  'framework-module-skipped',
  // A feature the files use that the build's own flag turns off: Nitro's tasks (P262)
  'framework-feature-off',
  // A navigation out of the application, to an address with a host (P265)
  'navigation-external',
  // Stand-ins for a package that is not installed (core/stand-ins.ts, P78)
  'package-from-repo',
  'package-version-differs',
  'shape-file-unmatched',
  // What a framework's build would have written for the compiler, read
  // without it (core/conventions.ts, P240): its aliases, and the imports it adds
  'aliases-from-convention',
  'aliases-from-config',
  'implicit-imports-from-convention',
  // The parts a framework builds an application from (P243): which were read,
  // and a name, page or route one part gives in place of another
  'implicit-import-overridden',
  'framework-layer-read',
  'framework-layer-overridden',
  // What a framework still decides when it builds (P251): the modules of the
  // repository that were read, the ones that are packages, and how another
  // environment's build differs from the one read
  'framework-module-read',
  'framework-module-installed',
  'framework-environment-differs',
  // The project's own extraction patterns (core/patterns, P121): a rule a
  // written description won over, and one nothing in its services matches
  'pattern-shadowed',
  'pattern-unmatched',
  // Joins made by a rule rather than read (linker)
  'base-url-from-files',
  'base-url-from-name',
  'environment-from-files',
  // A container publishes a port its service's code is not read listening on (P254)
  'published-port-unheard',
  // A request a server's proxy forwards to a host no service of the project is reached at (P257)
  'proxied-to-third-party',
  'route-api-guessed',
  'route-mount-assumed-empty',
  'stream-filter-not-matched',
  'workflow-named-by-file',
  // A deployment read as far as its files go (P57): a name the platform
  // generates, stood in for by its declaration; a declaration under a
  // condition the files do not settle; one the program never reaches.
  'deployed-name-generated',
  // A name a parameter with no value gives, stood in for by the parameter's
  // declaration (P268).
  'deployed-name-from-parameter',
  'construct-conditional',
  'construct-unreached',
  // Shared code a deployment hands its functions at run time, read as code
  // where it is in the repository and not joined to what loads it (P246).
  'layer-not-followed',
  // A copy of a description a packaging step wrote, its local paths swapped
  // for uploads, not read a second time beside the one it copies (P248).
  'deployment-copy-not-read',
  // The route audit, where the source says what was decided
  'route-checked-in-body',
  'route-guard-skipped',
  'route-public-declared',
  // A rule read over a service the build read in part (P114)
  'rule-over-partial-read',
  // An end declared by a document rather than read (cli/doctor/age.ts); the old
  // spelling as well, since a stored row may still carry it.
  'document-age',
  'openapi-document-age',
  // A store more than one service writes (cli/doctor/shared-store.ts, P228): sometimes the design.
  'store-shared',
  // A checkout that moved since the build (cli/doctor/checkout.ts, P230): the graph is of another commit.
  'checkout-moved',
  // A declared failure no request answered in the observed window (cli/doctor/runtime.ts, P106):
  // evidence beside the code, nothing missed.
  'failure-declared-unseen',
];

// Something about the code, true whatever the reader managed.
const FINDINGS: readonly string[] = [
  // Cost (the call-shape pass, P69)
  'query-in-loop',
  // A status traffic answered that the code does not declare (cli/doctor/runtime.ts, P106)
  'failure-seen-undeclared',
  // Who may ask (the route audit, linker)
  'route-unguarded',
  'route-shadowed',
  // A decision said with no reason to review it by (P90)
  'marker-reason-missing',
  // Two declarations where the framework takes one, or one it never serves
  'route-claimed-twice',
  'graphql-field-resolved-twice',
  // A federated graph its composition refuses, or a supergraph its subgraphs moved past (P241)
  'graphql-composition-conflict',
  'graphql-supergraph-drift',
  // The router's authorization directives composed by a gateway that does not check them (P245)
  'graphql-auth-not-checked',
  // A field using @requires that does not carry what the fields it requires ask (P256)
  'graphql-requires-auth-not-carried',
  // An entity call for an interface its owner can say no concrete type of (P252)
  'graphql-entity-type-unsaid',
  'route-file-not-served',
  'wizard-step-conflict',
  'workflow-name-duplicate',
  // Code the framework or the service refuses
  'orphan-scene-decorator',
  'orphan-update-decorator',
  'procedure-call-mismatch',
  // A client's link sent where no mount of its protocol answers (P58)
  'procedure-link-unserved',
  // A tree or a way in declared where no tree holds it and nothing names it (P270)
  'procedure-unmounted',
  // A request on a container's or a cluster's network to a port only the machine or the containers have (P257)
  'network-port-unreachable',
  // A server's own request with no host, made by a client with no origin to resolve it against (P263)
  'server-request-without-origin',
  // A helmfile release that needs one the helmfile does not declare, which helmfile refuses to apply (P273)
  'release-need-undefined',
  'workflow-definition-invalid',
  // Ends that nothing on the other side meets
  's3-write-matches-nothing',
  'stream-no-writer',
  'subscription-matches-nothing',
  // A job added to a queue whose every handler names another (P271)
  'job-no-handler',
];

// The reader could not follow something. Listed rather than left to the
// default, so the read gate can tell a reason somebody classified as a gap from
// one nobody looked at.
const GAPS: readonly string[] = [
  // A framework's conventions the reader could not read (P240): a name two
  // files give unimported, a layer, a setting written as code
  'implicit-import-ambiguous',
  'framework-layer-unread',
  'framework-setting-dynamic',
  // An import a layer writes for its own code that the framework resolves in
  // the application (P243)
  'framework-layer-alias',
  // A module of the repository, or one of its additions, the reader could not
  // place (P251)
  'framework-module-unread',
  // What traffic reached and no reader drew (core/blind-spots.ts, P110): asked
  // of the observed file at read time, at info, never stored in the graph.
  'seen-not-in-code',
  // A rule that could not be checked (P114): a selector that names nothing, a
  // rule that fails its schema. Never a pass (I3).
  'rule-matches-nothing',
  'rule-invalid',
  // Reading and the build (core/project.ts, cli/commands/build.ts)
  'file-not-parsed',
  'service-read-nothing',
  // An edge a reader drew to a node it never wrote, left out (core/builder.ts, R180)
  'edge-end-missing',
  'test-directory-skipped',
  // Stand-ins that could not be used (core/stand-ins.ts)
  'package-source-ambiguous',
  'shape-file-unread',
  // Pattern files and rules that could not be used (core/patterns, P121)
  'pattern-file-unread',
  'pattern-not-expressible',
  'pattern-ambiguous',
  // Types (core/types)
  'type-unresolved',
  'type-generic-uninstantiated',
  'type-depth-exceeded',
  // Dependency injection and calls
  'di-type-unresolved',
  'di-token-unknown',
  'di-token-ambiguous',
  'inject-token-unresolved',
  'call-dynamic-receiver',
  'call-module-ref',
  'call-through-token',
  // Modules and globals
  'module-import-dynamic',
  'module-import-not-installed',
  'module-controllers-unread',
  'module-providers-unread',
  'global-wrapper-dynamic',
  'middleware-route-dynamic',
  'middleware-matcher-unread',
  'bootstrap-not-found',
  'application-root-unread',
  // What a route fails with (the failures pass, P87)
  'fails-filter-unread',
  'fails-interceptor-unread',
  // Routes and registries (the entry adapters)
  'route-path-dynamic',
  'route-mount-unread',
  'route-handler-anonymous',
  'route-handler-unread',
  'fs-route-handler-not-read',
  'graphql-federation-not-read',
  'route-module-not-found',
  'route-verb-unread',
  'route-registry-unread',
  // A tool, prompt or resource an MCP server registers under a name decided at run time (P270)
  'mcp-name-dynamic',
  'registry-key-dynamic',
  'registry-handler-anonymous',
  'entry-registry-unconfigured',
  'server-action-unread',
  'entry-http-description-inactive',
  'entry-http-types-unmatched',
  'entry-http-routes-unmatched',
  'entry-http-routes-unplaced',
  // Trees of procedures, and their callers
  'procedure-router-unread',
  'procedure-branch-unread',
  'procedure-key-dynamic',
  'procedure-trees-unmatched',
  'procedure-members-unmatched',
  'procedure-path-dynamic',
  'entry-procedures-description-inactive',
  // A link, a mount's prefix and a contract's member nobody could read (P58)
  'procedure-link-dynamic',
  // A link that sends over a socket whose address is not read (P242)
  'procedure-link-socket',
  'procedure-prefix-unread',
  'procedure-contract-unread',
  // Bots
  'dynamic-bot-trigger',
  'bot-handlers-not-found',
  'decorator-arg-dynamic',
  // Channels and starts (the broker adapters)
  'channel-from-config',
  'channel-from-environment',
  'channel-dynamic',
  'channel-const-unresolved',
  'payload-type-unknown',
  'consumer-handler-unresolved',
  'start-from-environment',
  'start-name-unread',
  'starter-undescribed',
  // The data layer, settings, caches and outgoing addresses (the data adapters)
  'unknown-db-package',
  'unknown-db-operation',
  'db-receiver-name-only',
  'db-handover-unstated',
  'db-layer-unread',
  'db-package-unread',
  'sql-parse-failed',
  'dynamic-table-name',
  'db-call-at-module-level',
  'dynamic-config-key',
  'dynamic-cache-key',
  'dynamic-http-url',
  // The browser (the front-end readers)
  'api-path-dynamic',
  'graphql-document-dynamic',
  'graphql-document-not-parsed',
  'graphql-fragment-not-read',
  // A GraphQL client a call names that could not be followed to its address (P266)
  'graphql-client-unread',
  // A GraphQL endpoint's options or path, or which of them serves a resolver, not read (P266)
  'graphql-endpoint-unread',
  // A subgraph a gateway names whose address reaches no service (P241)
  'graphql-subgraph-not-joined',
  // An argument the router fills from a context no type above the field sets (P245)
  'graphql-context-not-reached',
  'api-method-dynamic',
  'api-base-override-unread',
  'api-client-base-unread',
  'api-base-unknown',
  'api-client-unread',
  'handler-not-found',
  'template-handler-not-found',
  // A child component, a layout or a route middleware a component names by a
  // name nothing registers, or by code (P255)
  'component-unresolved',
  'layout-unresolved',
  'route-middleware-unresolved',
  // A navigation to an address no page shows, two fit, or written as code (P265)
  'navigation-unresolved',
  'handler-not-a-method',
  'template-not-found',
  'template-not-parsed',
  'route-link-dynamic',
  'route-screen-unread',
  'route-target-unresolved',
  'route-loader-unread',
  'route-config-unread',
  // Ways in declared where a service is deployed (deployment files, deployed functions)
  'infra-file-unparsed',
  'infra-module-missing',
  'infra-module-undescribed',
  'infra-module-description-invalid',
  'function-name-unread',
  'function-name-disputed',
  'function-repeated-unread',
  'function-handler-unread',
  'function-handler-not-found',
  'function-handler-ambiguous',
  'function-source-unread',
  'function-runtime-unread',
  'function-image-unread',
  'route-path-unread',
  'route-target-unread',
  'route-base-path-unread',
  'subscription-source-unread',
  'subscription-target-unread',
  'subscription-forward-unread',
  'bucket-notification-unread',
  'event-pattern-unread',
  'api-body-unread',
  'deployment-unread',
  // A deployment read by interpreting the program that declares it (P57)
  'deployment-app-unread',
  'deployment-plugin-unread',
  'construct-repeated-unread',
  // A deployment nested in another whose description is published elsewhere (P246)
  'nested-deployment-unread',
  // A service a composition of deployments lists that is not read (P249)
  'compose-service-unread',
  // Two files beside one deployment description each hold the values it is deployed with (P253)
  'parameter-file-ambiguous',
  // Workflows written down as state machine definitions
  'workflow-definition-unreadable',
  'workflow-target-dynamic',
  'workflow-template-unbound',
  'workflow-target-unreadable',
  'workflow-name-unread',
  'workflow-definition-not-loaded',
  // Joining the repositories (linker)
  'route-root-not-found',
  'route-root-ambiguous',
  // A value one deployment reads from another's outputs, joined by its name (P249)
  'export-not-found',
  'export-ambiguous',
  'export-mismatched',
  'invoke-target-not-found',
  'invoke-target-ambiguous',
  'unknown-base-url-env',
  'service-binding-unknown',
  'target-route-not-found',
  'graphql-field-no-resolver',
  // Which subgraph answers is the router's choice at run time; every one is drawn (P241)
  'graphql-shareable-choice',
  'ambiguous-route',
  'ambiguous-route-application',
  'ambiguous-route-api',
  'ambiguous-route-target',
  // Two services listen on the port an address on this machine names (P250)
  'local-port-shared',
  // A server's proxy rule written in a way the reader does not follow (P257)
  'proxy-rule-unread',
  // A request forwarded through more servers than are followed, or in a circle (P260)
  'proxy-chain-unfollowed',
  // A cluster's manifest the reader does not follow: a template's undecided
  // conditions, a patch, a traffic split; and overlays or installs nothing
  // chooses among (P260)
  'manifest-unread',
  'manifest-overlay-unchosen',
  'route-wildcard-only',
  'marker-service-unknown',
  'marker-route-not-found',
  'procedure-not-found',
  'procedure-ambiguous',
  'duplicate-node-id',
  'reference-not-found',
  'reference-ambiguous',
  'environment-not-set',
  'environment-value-unread',
  'invoker-not-read',
  'iot-action-not-read',
  // Boundaries nothing could compare (contracts)
  'no-type-on-sender',
  'no-type-on-receiver',
  'body-already-serialised',
  'type-missing',
  'type-kind-unsupported',
  'ambiguous-handler',
  'channel-without-producer',
  'channel-without-consumer',
  'procedure-input-by-name',
  'procedure-input-undeclared',
  'procedure-input-unread',
  'procedure-input-not-at-call',
  'procedure-output-inferred',
  'envelope-unread',
  'message-unparsed',
  'message-undeclared',
  'delivered-onward',
  'delivery-target-unread',
  'handler-unread',
  'sender-forwards',
];

const registry = (): Map<string, RowKind> => {
  const kinds = new Map<string, RowKind>();
  const add = (reasons: readonly string[], kind: RowKind): void => {
    for (const reason of reasons) {
      const already = kinds.get(reason);
      // Two kinds for one reason would make every count depend on list order.
      if (already !== undefined) throw new Error(`row kind of ${reason} given twice (${already}, ${kind})`);
      kinds.set(reason, kind);
    }
  };
  add(GAPS, 'gap');
  add(NOTES, 'note');
  add(FINDINGS, 'finding');
  return kinds;
};

/** The kind of every reason somebody classified. A reason not here is a gap. */
export const ROW_KINDS: ReadonlyMap<string, RowKind> = registry();

/**
 * Where one reason's kind depends on what its row recorded.
 *
 * A Strategy per reason, asked only for the reasons listed, and answering
 * undefined to fall back on the registry. `query-in-loop` is a finding unless
 * the pass said the loop is per item on purpose (P89, `meta.severity: 'note'`):
 * a conditional write per row, a message per recipient. Those are counted with
 * the other notes, so the findings a reviewer is shown are only loops worth
 * fixing.
 */
const REFINED: ReadonlyMap<string, (row: KindedRow) => RowKind | undefined> = new Map([
  ['query-in-loop', (row: KindedRow) => (row.meta?.['severity'] === 'note' ? 'note' : undefined)],
]);

/** What a row is about. The one place a kind is decided; a stored kind is this, written down (P208). */
export const kindOfRow = (row: KindedRow): RowKind =>
  REFINED.get(row.reason)?.(row) ?? ROW_KINDS.get(row.reason) ?? 'gap';

/**
 * The reasons of a list that have no kind of their own, in the order given.
 *
 * For the read gate: every reason `doctor` knows is classified here on purpose,
 * so one that falls through to the default is one nobody decided about.
 */
export const reasonsWithoutKind = (reasons: Iterable<string>): string[] =>
  [...reasons].filter((reason) => !ROW_KINDS.has(reason));

/**
 * Which risk a finding is (P100): who may ask, what it costs, or how it is
 * wired. The page lists findings under Risks by this, auth first, and gives a
 * row its tone from it rather than from the words in its reason.
 *
 * - **auth** — who may reach what: a route with nothing in front of it
 *   (`route-unguarded`), one whose guards never run because a worker answers
 *   first (`route-shadowed`), a public marker with no reason to review it by
 *   (`marker-reason-missing`).
 * - **performance** — work repeated per item: a query once per item of a loop
 *   (`query-in-loop`, the likely N+1).
 * - **wiring** — code put together wrong, or meeting nothing: two declarations
 *   where the framework takes one, a declaration the framework never serves or
 *   refuses, an end nothing on the other side meets.
 *
 * Named by reason, never by framework, like the kinds. Only a finding has a
 * risk: a gap or a note is about the reading, not the code.
 * `scripts/check-doctor-reasons.mjs` fails on a finding with no risk here, so
 * a new finding is placed on purpose.
 */
export const RISK_NAMES = ['auth', 'performance', 'wiring'] as const;

/** What kind of risk a finding is. */
export type Risk = (typeof RISK_NAMES)[number];

const RISK_OF: ReadonlyArray<readonly [Risk, readonly string[]]> = [
  ['auth', ['route-unguarded', 'route-shadowed', 'marker-reason-missing', 'graphql-auth-not-checked', 'graphql-requires-auth-not-carried']],
  ['performance', ['query-in-loop']],
  [
    'wiring',
    [
      'route-claimed-twice',
      'graphql-field-resolved-twice',
      'graphql-composition-conflict',
      'graphql-supergraph-drift',
      'graphql-entity-type-unsaid',
      'route-file-not-served',
      'wizard-step-conflict',
      'workflow-name-duplicate',
      'orphan-scene-decorator',
      'orphan-update-decorator',
      'procedure-call-mismatch',
      'procedure-link-unserved',
      'procedure-unmounted',
      'network-port-unreachable',
      'server-request-without-origin',
      'release-need-undefined',
      'workflow-definition-invalid',
      's3-write-matches-nothing',
      'stream-no-writer',
      'subscription-matches-nothing',
      'job-no-handler',
      // A status traffic answered that no failure declares (P106): an
      // exception nobody mapped to the status it should answer.
      'failure-seen-undeclared',
    ],
  ],
];

const riskRegistry = (): Map<string, Risk> => {
  const risks = new Map<string, Risk>();
  for (const [risk, reasons] of RISK_OF) {
    for (const reason of reasons) {
      const already = risks.get(reason);
      if (already !== undefined) throw new Error(`risk of ${reason} given twice (${already}, ${risk})`);
      // A risk is what a finding is about; on a gap or a note it would put a
      // reading caveat under Risks.
      if (ROW_KINDS.get(reason) !== 'finding') throw new Error(`risk given to ${reason}, which is not a finding`);
      risks.set(reason, risk);
    }
  }
  return risks;
};

/** The risk of every finding, by reason. */
export const RISKS: ReadonlyMap<string, Risk> = riskRegistry();

/** Which risk a finding's reason is; undefined for a gap, a note, or a reason nobody classified. */
export const riskOf = (reason: string): Risk | undefined => RISKS.get(reason);

/**
 * The finding reasons of a list that have no risk, in the order given; every
 * finding by default. For the read gate, beside `reasonsWithoutKind`.
 */
export const findingsWithoutRisk = (
  reasons: Iterable<string> = [...ROW_KINDS].filter(([, kind]) => kind === 'finding').map(([reason]) => reason),
): string[] => [...reasons].filter((reason) => ROW_KINDS.get(reason) === 'finding' && !RISKS.has(reason));

/**
 * A row as a reader holds it: what it recorded, and the kind and risk the
 * graph database stored when the graph was written (P208), when it was read
 * from one that stores them.
 */
export interface StoredKindRow extends KindedRow {
  kind?: RowKind | null | undefined;
  /** A finding's risk as stored; null for a row stored without one (a gap, a note). */
  risk?: Risk | null | undefined;
}

const KIND_SET: ReadonlySet<string> = new Set(ROW_KIND_NAMES);
const RISK_SET: ReadonlySet<string> = new Set(RISK_NAMES);

/** Whether a value is a row kind: what a stored column is checked against before it is trusted. */
export const isRowKind = (value: unknown): value is RowKind => typeof value === 'string' && KIND_SET.has(value);

/**
 * The kind a row was stored with, or the one `kindOfRow` decides for a row
 * that has none stored. Every reader asks this, so a stored answer is read
 * and a row from anywhere else is classified exactly as before.
 */
export const rowKindOf = (row: StoredKindRow): RowKind => (isRowKind(row.kind) ? row.kind : kindOfRow(row));

/**
 * A finding's risk as it was stored, or as `riskOf` says for a row with no
 * kind stored. A gap or a note has none, whatever its reason: a loop per item
 * on purpose is a note, and no risk.
 */
export const rowRiskOf = (row: StoredKindRow): Risk | undefined => {
  if (isRowKind(row.kind)) return row.kind === 'finding' && typeof row.risk === 'string' && RISK_SET.has(row.risk) ? row.risk : undefined;
  return kindOfRow(row) === 'finding' ? riskOf(row.reason) : undefined;
};

/**
 * A row's kind and, for a finding, its risk, decided as `kindOfRow` and
 * `riskOf` decide them: what the graph database stores on each row (P208),
 * and what a row made at read time carries so it reads like a stored one.
 */
export const rowClassOf = (row: KindedRow): { kind: RowKind; risk?: Risk } => {
  const kind = kindOfRow(row);
  const risk = kind === 'finding' ? riskOf(row.reason) : undefined;
  return risk === undefined ? { kind } : { kind, risk };
};
