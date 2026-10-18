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
 * The kind is derived from the reason, never stored: a reason already says what
 * a row is, so old graphs, old databases and the read gate keep working with no
 * schema change. Kind and level are orthogonal. Level is how much a row matters
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
  // Stand-ins for a package that is not installed (core/stand-ins.ts, P78)
  'package-from-repo',
  'package-version-differs',
  'shape-file-unmatched',
  // The project's own extraction patterns (core/patterns, P121): a rule a
  // written description won over, and one nothing in its services matches
  'pattern-shadowed',
  'pattern-unmatched',
  // Joins made by a rule rather than read (linker)
  'base-url-from-files',
  'base-url-from-name',
  'environment-from-files',
  'route-api-guessed',
  'route-mount-assumed-empty',
  'stream-filter-not-matched',
  'workflow-named-by-file',
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
  'route-file-not-served',
  'wizard-step-conflict',
  'workflow-name-duplicate',
  // Code the framework or the service refuses
  'orphan-scene-decorator',
  'orphan-update-decorator',
  'procedure-call-mismatch',
  'workflow-definition-invalid',
  // Ends that nothing on the other side meets
  's3-write-matches-nothing',
  'stream-no-writer',
  'subscription-matches-nothing',
];

// The reader could not follow something. Listed rather than left to the
// default, so the read gate can tell a reason somebody classified as a gap from
// one nobody looked at.
const GAPS: readonly string[] = [
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
  'route-module-not-found',
  'route-verb-unread',
  'route-registry-unread',
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
  'api-method-dynamic',
  'api-base-override-unread',
  'api-base-unknown',
  'api-client-unread',
  'handler-not-found',
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
  'invoke-target-not-found',
  'invoke-target-ambiguous',
  'unknown-base-url-env',
  'service-binding-unknown',
  'target-route-not-found',
  'ambiguous-route',
  'ambiguous-route-application',
  'ambiguous-route-api',
  'ambiguous-route-target',
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

/** What a row is about. */
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
  ['auth', ['route-unguarded', 'route-shadowed', 'marker-reason-missing']],
  ['performance', ['query-in-loop']],
  [
    'wiring',
    [
      'route-claimed-twice',
      'route-file-not-served',
      'wizard-step-conflict',
      'workflow-name-duplicate',
      'orphan-scene-decorator',
      'orphan-update-decorator',
      'procedure-call-mismatch',
      'workflow-definition-invalid',
      's3-write-matches-nothing',
      'stream-no-writer',
      'subscription-matches-nothing',
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
