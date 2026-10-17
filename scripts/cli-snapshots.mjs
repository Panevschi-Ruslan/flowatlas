#!/usr/bin/env node
/**
 * Records what each query command prints for a fixed set of questions.
 *
 *   node scripts/cli-snapshots.mjs [--update]
 *
 * The unit tests assert behaviour against a hand-built graph; these hold the
 * exact bytes a person sees for the multi-repo fixture, at every detail level
 * and in every format. A change here is a change to the tool's face, so it
 * should be read before it is accepted.
 *
 * Everything is recorded with `--no-color --ascii`, which is what makes the
 * bytes the same on every terminal. The one exception is named `.ansi.txt` and
 * exists to lock the repository palette.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProject,
  runAccept,
  runCantFollowCommand,
  runPatternsExplain,
  runPatternsSuggest,
  runPatternsTest,
  runChannel,
  runContracts,
  runDead,
  runDiff,
  runDocs,
  runDoctorCommand,
  runFlow,
  runImpact,
  runObserve,
  runShapesSuggest,
  runStats,
  runTypes,
} from '../packages/cli/dist/index.js';
import { diffFixtureProject } from './diff-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures', 'multi-repo');
const outDir = join(fixture, 'expected.cli');
const update = process.argv.includes('--update');

const config = join(fixture, 'flowatlas.config.json');
const plain = { config, color: false, ascii: true };

const contractsFixture = join(root, 'fixtures', 'multi-repo-contracts');
const contractsConfig = join(contractsFixture, 'flowatlas.config.json');

const GATEWAY_ORDERS = 'entry:gateway:http:GET:/orders/:param';
const ORDERS_CREATE = 'orders#src/orders/orders.service.ts:OrdersService.create';

/**
 * `accept` handed an `accepted.json` it cannot read (P80): what `--list` says,
 * then the refusal to write over it, as stderr says it, with the exit code.
 * Run on a copy of the fixture's output, so nothing another snapshot reads is
 * written, and the copy's path said as `<copy>`.
 */
const acceptUnreadable = (io) => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-accept-unreadable-'));
  const said = (text) => text.split(copy).join('<copy>');
  try {
    cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
    writeFileSync(join(copy, 'accepted.json'), '{\n  "acceptedFormatVersion": 2,\n  "gaps": [\n<<<<<<< HEAD\n');
    const db = join(copy, 'graph.db');
    const print = (line) => io.out(said(`${line}\n`));
    runAccept(undefined, { db, list: true, print });
    try {
      runAccept('channel-dynamic', { db, note: 'known', print });
    } catch (error) {
      io.err(said(`${error.message}\n${error.details.map((line) => `${line}\n`).join('')}exit ${error.code}\n`));
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

/**
 * `flowatlas docs` over the fixture's own page (P120): what a check says, as
 * text, JSON and workflow commands, with the exit code; every block listed;
 * and the page as `--write` leaves it. The write is made on a copy of the
 * page and of the database, so neither the fixture nor the `docs.json` the
 * MCP snapshots read is touched; the checks write that index, the same one
 * `fixtures-run` writes.
 */
const docsAsked = (options) => (io) => {
  const run = runDocs([], { config, ...options }, io);
  io.err(`exit ${run.exitCode}\n`);
};

const docsWritten = (io) => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-docs-'));
  try {
    cpSync(join(fixture, 'docs'), join(copy, 'docs'), { recursive: true });
    // The database beside its own copy of the output, which a run never reads Markdown from.
    mkdirSync(join(copy, 'out'));
    for (const name of readdirSync(join(fixture, '.flowatlas')).filter((file) => file.startsWith('graph.db'))) {
      cpSync(join(fixture, '.flowatlas', name), join(copy, 'out', name));
    }
    const page = join(copy, 'docs', 'architecture.md');
    runDocs([page], { config, db: join(copy, 'out', 'graph.db'), write: true }, { out() {}, err() {} });
    io.out(readFileSync(page, 'utf8'));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

/**
 * `observe` over the fixture's four trace files (P105; P110 added the web
 * one, twenty page loads through a best-guess join), on a copy of the
 * fixture's output so no other snapshot reads the file it writes: the summary,
 * the file itself (`--format json`), and a second run over a file already read.
 * The clock is fixed, so the window and `readAt` are the same every run.
 * `observe.json` is also the observed file the MCP snapshots and tests answer from.
 */
const OBSERVE_NOW = new Date('2025-10-16T09:00:00.000Z');
const TRACES = ['checkout.otlp.json', 'billing.observe.json', 'billing.batches.observe.json', 'web.otlp.json'].map((file) =>
  join(fixture, 'traces', file),
);
/**
 * The same traffic exported by Zipkin and by Jaeger (P112) in place of the
 * OTLP file: each summary is `observe.txt` again, which is the point. And the
 * fixture's front end saved as a HAR, read with the configuration so its
 * calls' origins name the services they reached.
 */
const tracesWith = (file) => TRACES.map((path, index) => (index === 0 ? join(fixture, 'traces', file) : path));
const HAR = [join(fixture, 'traces', 'web.har')];
const observeOnCopy = (io, runs, from = fixture) => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-observe-'));
  const said = (text) => text.split(copy).join('<copy>');
  try {
    cpSync(join(from, '.flowatlas'), copy, { recursive: true });
    const db = join(copy, 'graph.db');
    for (const [files, options] of runs) {
      runObserve(files, { db, now: OBSERVE_NOW, print: (line) => io.out(said(`${line}\n`)), ...options });
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

/**
 * `doctor` beside the observed file (P106): the rows about failures traffic
 * answered and the code does not declare, and declared ones nobody answered,
 * for billing, under `--strict-runtime` so the verdict says them too.
 */
const doctorObservedOnCopy = (io, service = 'billing', extra = { strictRuntime: true }) => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-doctor-observed-'));
  const said = (text) => text.split(copy).join('<copy>');
  try {
    cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
    const db = join(copy, 'graph.db');
    runObserve(TRACES, { db, now: OBSERVE_NOW, print: () => {} });
    runDoctorCommand(
      { config, db, out: copy, section: ['unresolved'], service, ...extra },
      { ...io, out: (text) => io.out(said(text)) },
    );
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

/**
 * Beside the same file, what traffic says of the map itself (P110): the web
 * service's best guesses, one of which twenty page loads went through;
 * `doctor --unresolved` with the blind spots under their own cause; and
 * `dead` with the seen column, over everything the file holds and over its
 * last hour.
 */
const onObservedCopy = async (io, run) => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-traffic-'));
  const said = (text) => text.split(copy).join('<copy>');
  try {
    cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
    const db = join(copy, 'graph.db');
    runObserve(TRACES, { db, now: OBSERVE_NOW, print: () => {} });
    await run({ db, out: copy }, { ...io, out: (text) => io.out(said(text)) });
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};
/**
 * `observe --shapes` (P113) over the same traces and the HAR, with the
 * configuration so the HAR's origins name their services: the summary, the
 * file itself (the observed file the shapes MCP suite answers from), and
 * `contracts` beside it, whose `traffic` section compares each route's
 * bodies with its code, for the gateway the front end calls.
 */
const SHAPED = [...TRACES, ...HAR];
const contractsOnShapedCopy = (io) =>
  onObservedCopy(io, async ({ db, out }, said) => {
    runObserve(SHAPED, { db, config, now: OBSERVE_NOW, shapes: true, reset: true, print: () => {} });
    runContracts({ config, db, out, format: 'json', service: 'gateway' }, said);
  });
const deadOnObservedCopy = (io, options) =>
  onObservedCopy(io, async ({ db }, out) => {
    const { lines } = await runDead({ config, db, ...options });
    out.out(`${lines.join('\n')}\n`);
  });

/** One question per file, named for what it asks and how it is drawn. */
const CASES = [
  ['docs.architecture.md', docsWritten],
  ['docs.check.txt', docsAsked({ check: true })],
  ['docs.check.json', docsAsked({ check: true, format: 'json' })],
  ['docs.check.github.txt', docsAsked({ check: true, format: 'github' })],
  ['docs.list.txt', docsAsked({ list: true })],
  ['doctor.observed.txt', doctorObservedOnCopy],
  ['doctor.observed.web.txt', (io) => doctorObservedOnCopy(io, 'web', {})],
  [
    'doctor.unresolved.observed.txt',
    (io) => onObservedCopy(io, ({ db }, out) => runCantFollowCommand({ config, db, unresolved: true, cause: 'seen-not-in-code' }, out)),
  ],
  ['dead.observed.txt', (io) => deadOnObservedCopy(io, { kind: 'entries' })],
  ['dead.observed.since-1h.txt', (io) => deadOnObservedCopy(io, { kind: 'entries', since: '1h' })],
  ['dead.observed.channels.txt', (io) => deadOnObservedCopy(io, { kind: 'channels' })],
  ['observe.txt', (io) => observeOnCopy(io, [[TRACES, {}]])],
  ['observe.json', (io) => observeOnCopy(io, [[TRACES, { format: 'json' }]])],
  ['observe.again.txt', (io) => observeOnCopy(io, [[TRACES.slice(0, 1), { print: () => {} }], [TRACES, {}]])],
  ['observe.zipkin.txt', (io) => observeOnCopy(io, [[tracesWith('checkout.zipkin.json'), {}]])],
  ['observe.jaeger.txt', (io) => observeOnCopy(io, [[tracesWith('checkout.jaeger.json'), {}]])],
  ['observe.har.txt', (io) => observeOnCopy(io, [[HAR, { config }]])],
  ['observe.shapes.txt', (io) => observeOnCopy(io, [[SHAPED, { config, shapes: true }]])],
  ['observe.shapes.json', (io) => observeOnCopy(io, [[SHAPED, { config, shapes: true, format: 'json' }]])],
  ['contracts.traffic.json', contractsOnShapedCopy],
  ['accept.unreadable.txt', acceptUnreadable],
  ['flow.get-orders.tree.l0.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'tree', detail: '0' }, io)],
  ['flow.get-orders.tree.l1.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'tree' }, io)],
  ['flow.get-orders.tree.l2.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'tree', detail: '2' }, io)],
  ['flow.get-orders.json.l0.json', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'json', detail: '0' }, io)],
  ['flow.get-orders.json.l1.json', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'json' }, io)],
  ['flow.get-orders.json.l2.json', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'json', detail: '2' }, io)],
  ['flow.get-orders.json.l3.json', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'json', detail: '3' }, io)],
  ['flow.get-orders.mermaid.l0.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'mermaid', detail: '0' }, io)],
  ['flow.get-orders.mermaid.l1.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'mermaid' }, io)],
  ['flow.get-orders.mermaid.l2.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'mermaid', detail: '2' }, io)],
  ['flow.post-orders.tree.ansi.txt', (io) => runFlow('entry:orders:http:POST:/orders', { config, format: 'tree' }, { ...io, tty: true })],
  ['flow.post-orders.truncated.tree.txt', (io) => runFlow('entry:orders:http:POST:/orders', { ...plain, format: 'tree', maxNodes: '5' }, io)],
  ['flow.post-orders.sequence.txt', (io) => runFlow('entry:orders:http:POST:/orders', { ...plain, format: 'sequence' }, io)],
  ['flow.get-orders.sequence.class.txt', (io) => runFlow(GATEWAY_ORDERS, { ...plain, format: 'sequence', sequenceDetail: 'class' }, io)],
  ['impact.orders-create.tree.txt', (io) => runImpact(ORDERS_CREATE, { ...plain, format: 'tree' }, io)],
  ['impact.orders-create.json', (io) => runImpact(ORDERS_CREATE, { ...plain, format: 'json' }, io)],
  ['impact.orders-create.entries-only.tree.txt', (io) => runImpact(ORDERS_CREATE, { ...plain, format: 'tree', entriesOnly: true }, io)],
  ['channel.order-created.tree.txt', (io) => runChannel('order.created', { ...plain, format: 'tree' }, io)],
  ['channel.order-created.json', (io) => runChannel('order.created', { ...plain, format: 'json' }, io)],
  ['channel.order-archived.tree.txt', (io) => runChannel('order.archived', { ...plain, format: 'tree' }, io)],
  ['channel.invoice-requested.tree.txt', (io) => runChannel('invoice.requested', { ...plain, format: 'tree' }, io)],
  ['types.drift.tree.txt', (io) => runTypes({ ...plain, format: 'tree', drift: true }, io)],
  ['types.drift.json', (io) => runTypes({ ...plain, format: 'json', drift: true }, io)],
  ['types.list.tree.txt', (io) => runTypes({ ...plain, format: 'tree' }, io)],
  ['types.list.json.l2.json', (io) => runTypes({ ...plain, format: 'json', detail: '2' }, io)],
  ['stats.tree.txt', (io) => runStats({ ...plain, format: 'tree' }, io)],
  ['stats.json', (io) => runStats({ ...plain, format: 'json' }, io)],
];

/**
 * The contract report, in the three ways a person can ask for it.
 *
 * Recorded beside the fixture it is about rather than in a folder of its own,
 * because the fixture is four repositories that disagree on purpose and the
 * report is the answer to the whole of it. What each pair of declarations means
 * is asserted in `packages/cli/src/commands/contracts.test.ts`; these hold the
 * exact bytes a person sees.
 */
const CONTRACT_CASES = [
  ['expected.contracts.txt', (io) => runContracts({ config: contractsConfig }, io)],
  [
    'expected.contracts.md',
    (io) => runContracts({ config: contractsConfig, format: 'markdown' }, io),
  ],
  ['expected.contracts.json', (io) => runContracts({ config: contractsConfig, format: 'json' }, io)],
];

const doctorFixture = join(root, 'fixtures', 'multi-repo-doctor');
const doctorConfig = join(doctorFixture, 'flowatlas.config.json');
const doctorBaseline = join(doctorFixture, 'baseline.accepted.json');

/**
 * The health check, in the three ways a person or a build can ask for it.
 *
 * Recorded against the baseline this fixture ships rather than against no
 * baseline, because the interesting output is the one a project that has
 * adopted the check actually sees. What each row means is asserted in
 * `packages/cli/src/commands/doctor.test.ts`; these hold the exact bytes.
 */
const DOCTOR_CASES = [
  [
    'expected.doctor.txt',
    (io) => runDoctorCommand({ config: doctorConfig, baseline: doctorBaseline }, io),
  ],
  [
    'expected.doctor.json',
    (io) => runDoctorCommand({ config: doctorConfig, baseline: doctorBaseline, format: 'json' }, io),
  ],
  [
    'expected.doctor.github.txt',
    (io) =>
      runDoctorCommand({ config: doctorConfig, baseline: doctorBaseline, format: 'github' }, io),
  ],
  // One reason on its own (P141), every place of it: the nine the report
  // above lists six of.
  [
    'expected.doctor.reason.txt',
    (io) => runDoctorCommand({ config: doctorConfig, reason: ['unknown-db-package'], maxNodes: '20' }, io),
  ],
];

const foldedFixture = join(root, 'fixtures', 'folded-channels');
const foldedConfig = join(foldedFixture, 'flowatlas.config.json');

/**
 * A publish whose channel name the reader works out, and what is said about it.
 *
 * The channel query holds the join: one of three names folded out of a template
 * in `api`, and the handler in `worker` that names it outright. The health check
 * holds the three rows that say the annotations restate the code — all three,
 * which is the part a producer reaching several channels used to get wrong.
 */
const FOLDED_CASES = [
  ['expected.channel.closed.tree.txt', (io) => runChannel('order:*:closed', { config: foldedConfig, color: false, ascii: true, format: 'tree' }, io)],
  ['expected.doctor.txt', (io) => runDoctorCommand({ config: foldedConfig }, io)],
];

const hollowFixture = join(root, 'fixtures', 'next-hollow');
const hollowConfig = join(hollowFixture, 'flowatlas.config.json');

/**
 * A graph nobody can be told is healthy, for two separate reasons (R94, R106).
 *
 * The whole project fails twice over: `widget` contributed nothing, and most of
 * `shop`'s ways in were read no further than their addresses. Narrowed to
 * `shop` it is the auditor's reproduction — the service that read nothing
 * taken away — and it still exits 2, which it did not while the second reason
 * was an ordinary row a baseline could accept.
 */
const HOLLOW_CASES = [
  ['expected.doctor.txt', (io) => runDoctorCommand({ config: hollowConfig }, io)],
  ['expected.doctor.shop.txt', (io) => runDoctorCommand({ config: hollowConfig, service: 'shop' }, io)],
];

const socketFixture = join(root, 'fixtures', 'socket-channels');
const socketConfig = join(socketFixture, 'flowatlas.config.json');

/**
 * A channel whose two ends are in different repositories and neither is a route.
 *
 * The one query that shows what the socket reader is for: a gateway publishing
 * and a browser handling the same name, under the namespace the gateway
 * declares. The graph beneath it is already gated by the fixture's own
 * snapshot; this holds the bytes a person reads.
 */
const SOCKET_CASES = [
  ['expected.channel.updated.tree.txt', (io) => runChannel('orders/order:updated', { config: socketConfig, color: false, ascii: true, format: 'tree' }, io)],
];

const lambdaFixture = join(root, 'fixtures', 'multi-repo-lambda');
const lambdaConfig = join(lambdaFixture, 'flowatlas.config.json');

/**
 * A route declared in Terraform, walked from the request to the table (P21).
 *
 * The route hangs from an API another repository owns, so its address is the
 * one the linker joined; the walk shows the authoriser and the middleware chain
 * in front of the handler, and the handler's body after it. The health check
 * holds the two rows a disputed variable leaves, which say what to set.
 */
const LAMBDA_CASES = [
  ['expected.flow.post-loans.tree.txt', (io) => runFlow('POST /v1/loans', { config: lambdaConfig, color: false, ascii: true, format: 'tree' }, io)],
  ['expected.doctor.txt', (io) => runDoctorCommand({ config: lambdaConfig }, io)],
];

/**
 * A workflow read from state machine definitions, walked and reached into.
 *
 * The graph beneath it is gated by the fixture's own snapshot; these hold what a
 * person reads. A workflow is a chain of steps longer than the default depth a
 * walk stops at, so each asks for the whole of it.
 */
const workflowsFixture = join(root, 'fixtures', 'stepfunctions-asl-files');
const workflowsConfig = join(workflowsFixture, 'flowatlas.config.json');
const workflowsPlain = { config: workflowsConfig, color: false, ascii: true };
const RECORD_NOTICE = 'notifications#workflows/borrower-notifications.asl.yaml:borrower-notifications/RecordNotice';

const WORKFLOW_CASES = [
  ['flow.loan-approval.tree.txt', (io) => runFlow('workflow:loan-approval', { ...workflowsPlain, format: 'tree', depth: '24' }, io)],
  ['flow.loan-approval.json.l2.json', (io) => runFlow('workflow:loan-approval', { ...workflowsPlain, format: 'json', detail: '2', depth: '24' }, io)],
  ['impact.record-notice.tree.txt', (io) => runImpact(RECORD_NOTICE, { ...workflowsPlain, format: 'tree', depth: '24' }, io)],
  ['impact.record-notice.entries-only.tree.txt', (io) => runImpact(RECORD_NOTICE, { ...workflowsPlain, format: 'tree', depth: '24', entriesOnly: true }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: workflowsConfig }, io)],
];

/**
 * Workflows read from the Terraform that deploys them (P22, part B).
 *
 * No case passes `--depth`: the default walks every step of a workflow and on
 * into each handler, and back up from a handler through every step it climbs,
 * and these are what show that it does.
 */
const deployedWorkflowsFixture = join(root, 'fixtures', 'stepfunctions-terraform');
const deployedWorkflowsPlain = { config: join(deployedWorkflowsFixture, 'flowatlas.config.json'), color: false, ascii: true };

const DEPLOYED_WORKFLOW_CASES = [
  ['flow.loan-approval.tree.txt', (io) => runFlow('workflow:lending-loan-approval', { ...deployedWorkflowsPlain, format: 'tree' }, io)],
  ['flow.loan-renewal.tree.txt', (io) => runFlow('workflow:lending-loan-renewal', { ...deployedWorkflowsPlain, format: 'tree' }, io)],
  ['flow.overdue-sweep.json.l2.json', (io) => runFlow('workflow:lending-overdue-sweep', { ...deployedWorkflowsPlain, format: 'json', detail: '2' }, io)],
  [
    'impact.notify-borrower.entries-only.tree.txt',
    (io) => runImpact('lending#src/handlers/notify-borrower.ts:handler', { ...deployedWorkflowsPlain, format: 'tree', entriesOnly: true }, io),
  ],
  ['doctor.txt', (io) => runDoctorCommand({ config: deployedWorkflowsPlain.config }, io)],
];

/**
 * `observe` over a Lambda project's trace (P107): one checkout through an
 * HTTP API, a queue, a table's stream and a workflow, as an OpenTelemetry
 * Lambda layer writes it, laid over the map its Terraform and state machine
 * draw. The summary and the file, with the clock fixed.
 */
const lambdaTracesFixture = join(root, 'fixtures', 'lambda-traces');
const LAMBDA_TRACES = [join(lambdaTracesFixture, 'traces', 'adot.otlp.json')];
/**
 * The same checkout as the four exports a Lambda team can make without a
 * collector (P108): X-Ray traces, the workflow's execution history, the API's
 * access log and the functions' REPORT lines, each read on its own, and all
 * of them together as the file they make.
 */
const lambdaExport = (file) => join(lambdaTracesFixture, 'exports', file);
const LAMBDA_EXPORTS = {
  xray: lambdaExport('xray.batch-get-traces.json'),
  history: lambdaExport('fulfil-order.history.json'),
  accessLog: lambdaExport('checkout.access-log.jsonl'),
  reportsJson: lambdaExport('report-lines.insights.json'),
  reportsCsv: lambdaExport('report-lines.insights.csv'),
};
const LAMBDA_TRACE_CASES = [
  ['observe.txt', (io) => observeOnCopy(io, [[LAMBDA_TRACES, { reset: true }]], lambdaTracesFixture)],
  ['observe.json', (io) => observeOnCopy(io, [[LAMBDA_TRACES, { format: 'json', reset: true }]], lambdaTracesFixture)],
  ['observe.xray.txt', (io) => observeOnCopy(io, [[[LAMBDA_EXPORTS.xray], { reset: true }]], lambdaTracesFixture)],
  ['observe.sfn-history.txt', (io) => observeOnCopy(io, [[[LAMBDA_EXPORTS.history], { reset: true }]], lambdaTracesFixture)],
  ['observe.apigw-access-log.txt', (io) => observeOnCopy(io, [[[LAMBDA_EXPORTS.accessLog], { reset: true }]], lambdaTracesFixture)],
  ['observe.lambda-report.txt', (io) => observeOnCopy(io, [[[LAMBDA_EXPORTS.reportsJson], { reset: true }]], lambdaTracesFixture)],
  ['observe.lambda-report.csv.txt', (io) => observeOnCopy(io, [[[LAMBDA_EXPORTS.reportsCsv], { reset: true }]], lambdaTracesFixture)],
  [
    'observe.exports.json',
    (io) =>
      observeOnCopy(
        io,
        [[[LAMBDA_EXPORTS.xray, LAMBDA_EXPORTS.history, LAMBDA_EXPORTS.accessLog, LAMBDA_EXPORTS.reportsJson], { format: 'json', reset: true }]],
        lambdaTracesFixture,
      ),
  ],
];

const multiRepoWorkflowsFixture = join(root, 'fixtures', 'multi-repo-stepfunctions');
const multiRepoWorkflowsPlain = { config: join(multiRepoWorkflowsFixture, 'flowatlas.config.json'), color: false, ascii: true };

const MULTI_REPO_WORKFLOW_CASES = [
  ['flow.checkout.tree.txt', (io) => runFlow('workflow:circulation-checkout', { ...multiRepoWorkflowsPlain, format: 'tree' }, io)],
  [
    'impact.check-standing.tree.txt',
    (io) => runImpact('members#src/handlers/check-standing.ts:handler', { ...multiRepoWorkflowsPlain, format: 'tree' }, io),
  ],
  [
    'impact.send-notice.entries-only.tree.txt',
    (io) => runImpact('members#src/handlers/send-notice.ts:handler', { ...multiRepoWorkflowsPlain, format: 'tree', entriesOnly: true }, io),
  ],
  [
    'channel.loan-checked-out.json',
    (io) => runChannel('eventbridge/library/library.circulation/LoanCheckedOut', { ...multiRepoWorkflowsPlain, format: 'json' }, io),
  ],
  ['doctor.txt', (io) => runDoctorCommand({ config: multiRepoWorkflowsPlain.config }, io)],
];

/**
 * Channels whose subscriber is declared in Terraform (P23), walked from the
 * route a person calls into whatever the subscriber runs.
 *
 * One fixture each for a bus, for queues and a topic, and for both halves in
 * different repositories. The channel is recorded as JSON because that is where
 * a join that is less than proven says why.
 */
const plainFor = (name) => ({ config: join(root, 'fixtures', name, 'flowatlas.config.json'), color: false, ascii: true });
const eventsPlain = plainFor('eventbridge-terraform');
const queuesPlain = plainFor('sqs-sns-terraform');
const multiEventsPlain = plainFor('multi-repo-events');

const EVENT_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...eventsPlain, format: 'tree' }, io)],
  ['flow.renew-loan.tree.txt', (io) => runFlow('POST /loans/:param/renewals', { ...eventsPlain, format: 'tree', depth: '24' }, io)],
  ['flow.post-holds.tree.txt', (io) => runFlow('POST /holds', { ...eventsPlain, format: 'tree' }, io)],
  ['channel.loan-renewed.json', (io) => runChannel('eventbridge/library/library.loans/LoanRenewed', { ...eventsPlain, format: 'json' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: eventsPlain.config }, io)],
];

const QUEUE_CASES = [
  ['flow.post-returns.tree.txt', (io) => runFlow('POST /returns', { ...queuesPlain, format: 'tree', depth: '24' }, io)],
  ['flow.post-holds.tree.txt', (io) => runFlow('POST /holds', { ...queuesPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: queuesPlain.config }, io)],
];

const MULTI_EVENT_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...multiEventsPlain, format: 'tree' }, io)],
  ['channel.loan-returned.json', (io) => runChannel('eventbridge/library/library.loans/LoanReturned', { ...multiEventsPlain, format: 'json' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: multiEventsPlain.config }, io)],
];

/**
 * Handlers re-exported through a namespace and through `export … from` (R168):
 * a route through a queue to a consumer that lands, and one through a queue to a
 * consumer whose handler cannot be read, which the path counts; and a route
 * straight onto that function, which passes its entry and counts the same row
 * (R173).
 */
const namespacePlain = plainFor('lambda-namespace-handlers');

const NAMESPACE_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...namespacePlain, format: 'tree' }, io)],
  ['flow.archive-loan.tree.txt', (io) => runFlow('POST /loans/:param/archive', { ...namespacePlain, format: 'tree' }, io)],
  ['flow.post-returns.tree.txt', (io) => runFlow('POST /returns', { ...namespacePlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: namespacePlain.config }, io)],
];

/**
 * Code that starts a workflow or invokes a function by its deployed name (P24),
 * walked from the route a person calls into the workflow it starts and the
 * functions that workflow invokes: the SDK called directly, then a helper whose
 * source is read and one whose package is absent and described.
 */
const sdkStartsPlain = plainFor('start-workflow-sdk');
const helperStartsPlain = plainFor('start-workflow-helper');

const SDK_START_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...sdkStartsPlain, format: 'tree' }, io)],
  ['flow.post-reviews.tree.txt', (io) => runFlow('POST /reviews', { ...sdkStartsPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: sdkStartsPlain.config }, io)],
];

const HELPER_START_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...helperStartsPlain, format: 'tree' }, io)],
  ['flow.post-loans.json.l2.json', (io) => runFlow('POST /loans', { ...helperStartsPlain, format: 'json', detail: '2' }, io)],
  ['flow.renew-loan.tree.txt', (io) => runFlow('POST /loans/:param/renewals', { ...helperStartsPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: helperStartsPlain.config }, io)],
];

/**
 * A start addressed by a record made one call earlier (R171): the described
 * pair joined at `declared`, a start whose record was made elsewhere, and the
 * hint offered to the calls shaped like a start and to nothing else.
 */
const recordStartsPlain = plainFor('start-workflow-by-record');

const RECORD_START_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...recordStartsPlain, format: 'tree' }, io)],
  ['flow.post-loans.json.l2.json', (io) => runFlow('POST /loans', { ...recordStartsPlain, format: 'json', detail: '2' }, io)],
  ['flow.resume-run.tree.txt', (io) => runFlow('POST /runs/:param/resume', { ...recordStartsPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: recordStartsPlain.config }, io)],
];

/**
 * A publish whose name is the value of an environment variable nothing deployed
 * here sets (R177): its row names the producer, which the walk from the route
 * passes, so the path counts it.
 */
const sdkPublishersPlain = plainFor('aws-sdk-publishers');

const SDK_PUBLISHER_CASES = [
  ['flow.post-returns-overdue.tree.txt', (io) => runFlow('POST /returns/overdue', { ...sdkPublishersPlain, format: 'tree' }, io)],
];

/**
 * Names followed through (R175): a start handed in through a module function, a
 * client in a workspace package beside the functions' own `src/`, and an
 * address the deployment sets with a default for when it does not.
 */
const functionStartsPlain = plainFor('start-workflow-function-helper');
const workspaceRootPlain = plainFor('lambda-workspace-root');
const fallbackPlain = plainFor('sqs-environment-fallback');

const FUNCTION_START_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...functionStartsPlain, format: 'tree' }, io)],
  ['flow.renew-loan.tree.txt', (io) => runFlow('POST /loans/:param/renewals', { ...functionStartsPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: functionStartsPlain.config }, io)],
];

const WORKSPACE_ROOT_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...workspaceRootPlain, format: 'tree' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: workspaceRootPlain.config }, io)],
];

const FALLBACK_CASES = [
  ['flow.post-returns.tree.txt', (io) => runFlow('POST /returns', { ...fallbackPlain, format: 'tree', depth: '24' }, io)],
  ['flow.post-returns-bulk.tree.txt', (io) => runFlow('POST /returns/bulk', { ...fallbackPlain, format: 'tree', depth: '24' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: fallbackPlain.config }, io)],
];

/**
 * Terraform shapes read since R174: configuration written as JSON, an API
 * created from its OpenAPI document, a WebSocket API, base paths a domain puts
 * in front of an API, a rule that forwards to another bus by a pattern, and a
 * write to a table reaching the function its stream runs (P51).
 * Each fixture's health check is the proof it is read without a row; the walk
 * is what each shape adds.
 */
const terraformShape = (name, cases) => {
  const plain = plainFor(name);
  return {
    dir: join(root, 'fixtures', name, 'expected.cli'),
    owned: true,
    cases: [
      ...cases.map(([file, route]) => [file, (io) => runFlow(route, { ...plain, format: 'tree' }, io)]),
      ['doctor.txt', (io) => runDoctorCommand({ config: plain.config }, io)],
    ],
  };
};

/**
 * What the reader could not follow, grouped by cause and package (P75): the
 * breakdown as a terminal prints it and as a script reads it, the whole
 * project and narrowed to one package.
 */
const cantFollowPlain = plainFor('cant-follow');

const CANT_FOLLOW_CASES = [
  ['doctor.unresolved.txt', (io) => runCantFollowCommand({ config: cantFollowPlain.config }, io)],
  ['doctor.unresolved.json', (io) => runCantFollowCommand({ config: cantFollowPlain.config, json: true }, io)],
  [
    'doctor.unresolved.ledger.txt',
    (io) => runCantFollowCommand({ config: cantFollowPlain.config, package: '@shopkit/ledger', samples: '1' }, io),
  ],
  ['doctor.unresolved.top2.txt', (io) => runCantFollowCommand({ config: cantFollowPlain.config, top: '2' }, io)],
  ['doctor.txt', (io) => runDoctorCommand({ config: cantFollowPlain.config }, io)],
];

/**
 * A project read with nothing installed, where a repository's source and a
 * shape file stand in for two of its packages and nothing for the third (P78):
 * what is still missing, and what `shapes --suggest` says to write for it.
 */
const standInsPlain = plainFor('uninstalled-internal-packages');

/**
 * Tables written down one step away from the query (P88): what is still a gap
 * once the three shapes are read, and the calls an edge explains, counted.
 */
const tablesElsewherePlain = plainFor('tables-set-elsewhere');

const TABLES_ELSEWHERE_CASES = [
  ['doctor.txt', (io) => runDoctorCommand({ config: tablesElsewherePlain.config }, io)],
  ['stats.tree.txt', (io) => runStats({ ...tablesElsewherePlain, format: 'tree' }, io)],
];

/**
 * Loops that run a query per item (P89): the likely N+1 loops ranked by the
 * ways in that reach them, the per-item ones as notes, and the loops set aside
 * counted by why.
 */
const loopsPlain = plainFor('loops-worth-fixing');

const LOOPS_CASES = [
  ['doctor.txt', (io) => runDoctorCommand({ config: loopsPlain.config }, io)],
  ['stats.tree.txt', (io) => runStats({ ...loopsPlain, format: 'tree' }, io)],
];

const STAND_IN_CASES = [
  ['doctor.unresolved.txt', (io) => runCantFollowCommand({ config: standInsPlain.config }, io)],
  ['shapes.suggest.txt', (io) => runShapesSuggest({ config: standInsPlain.config, suggest: true }, io)],
  ['shapes.suggest.json', (io) => runShapesSuggest({ config: standInsPlain.config, suggest: true, json: true }, io)],
];

/**
 * Routes that refuse a request through a helper, and routes public by a marker
 * only (P90): the health check names the helper with what it can choose, lists
 * the declared ones at info, and leaves the rest unguarded.
 */
const helperCheckPlain = plainFor('nest-check-through-helper');

const HELPER_CHECK_CASES = [['doctor.txt', (io) => runDoctorCommand({ config: helperCheckPlain.config }, io)]];

/**
 * Routes nobody calls, told apart (P91): the one the command is for, the one a
 * request read in part could still reach, and the probes, webhooks and
 * callbacks something outside calls, folded and then listed.
 */
const deadRoutesPlain = plainFor('multi-repo-dead-routes');
const deadText = async (io, options) => {
  const { lines } = await runDead({ config: deadRoutesPlain.config, kind: 'entries', ...options });
  io.out(`${lines.join('\n')}\n`);
};

const DEAD_ROUTE_CASES = [
  ['dead.txt', (io) => deadText(io, {})],
  ['dead.infrastructure.txt', (io) => deadText(io, { class: 'infrastructure' })],
  [
    'dead.json',
    async (io) => {
      const { result } = await runDead({ config: deadRoutesPlain.config, kind: 'entries' });
      io.out(`${JSON.stringify(result, null, 2)}\n`);
    },
  ],
  ['doctor.txt', (io) => runDoctorCommand({ config: deadRoutesPlain.config }, io)],
];

/**
 * The project's own extraction patterns (P121): the rules' tests, one that
 * fails on purpose, starters suggested for the variant that lists no pattern
 * file, a near miss explained on the variant with two rules on one call, and
 * what the reader could not follow with the file and without it. The variants
 * are built into their own output, which nothing else reads.
 */
const housePlain = plainFor('house-patterns');
const houseVariant = (name) => join(root, 'fixtures', 'house-patterns', 'variants', name, 'flowatlas.config.json');
const builtVariants = new Map();
const variantBuilt = async (name) => {
  if (!builtVariants.has(name)) builtVariants.set(name, buildProject({ config: houseVariant(name), builtAt: '1970-01-01T00:00:00.000Z', cache: false }));
  await builtVariants.get(name);
  return houseVariant(name);
};

const HOUSE_CASES = [
  ['patterns.test.txt', (io) => runPatternsTest([], { config: housePlain.config }, io)],
  ['patterns.test.json', (io) => runPatternsTest([], { config: housePlain.config, json: true }, io)],
  ['patterns.test.descriptor.txt', (io) => runPatternsTest([], { config: housePlain.config, rule: 'api-client-call', showDescriptor: true }, io)],
  [
    'patterns.test.wrong.txt',
    (io) => runPatternsTest([join(root, 'fixtures', 'house-patterns', 'variants', 'wrong-expectation.yml')], { config: housePlain.config }, io),
  ],
  ['patterns.suggest.txt', async (io) => runPatternsSuggest({ config: await variantBuilt('no-patterns'), minSites: '1' }, io)],
  [
    'patterns.explain.txt',
    async (io) => runPatternsExplain('catalog/src/books/books.service.ts:23', { config: await variantBuilt('ambiguous') }, io),
  ],
  ['doctor.unresolved.txt', (io) => runCantFollowCommand({ config: housePlain.config }, io)],
  ['doctor.unresolved.no-patterns.txt', async (io) => runCantFollowCommand({ config: await variantBuilt('no-patterns') }, io)],
  ['doctor.ambiguous.txt', async (io) => runDoctorCommand({ config: await variantBuilt('ambiguous') }, io)],
];

/**
 * The pull-request document `flowatlas diff` writes for `fixtures/multi-repo-diff`
 * (P116), with its changed flows drawn, and the `diff.json` beside it. The
 * project's history is made once, the same commits on every machine
 * (`diff-fixture.mjs`); what still differs between runs - how long each side
 * took, and where the copy was made - is written as a placeholder.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
let diffProject;
const diffProjectOnce = async () => (diffProject ??= await diffFixtureProject(root));
const quiet = { out() {}, err() {}, tty: false };
const diffRun = async (options) => {
  const { scratch, config: diffConfig } = await diffProjectOnce();
  const run = await runDiff('HEAD~1', undefined, { config: diffConfig, generatedAt: FIXED, ...options }, quiet);
  const placed = (text) => text.split(scratch).join('<scratch>');
  return { run, placed };
};
const diffMarkdown = (options) => async (io) => {
  const { run, placed } = await diffRun(options);
  io.out(placed(run.text).replace(/base \d+ms · head \d+ms · diff \d+ms · \d+ms total/, 'base <ms> · head <ms> · diff <ms> · <ms> total'));
};

const DIFF_CASES = [
  ['diff.md', diffMarkdown({})],
  ['diff.class.md', diffMarkdown({ sequenceDetail: 'class', maxDiagrams: '1', context: '0' })],
  [
    'diff.json',
    async (io) => {
      const { run, placed } = await diffRun({});
      const report = { ...run.report, timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 } };
      io.out(placed(`${JSON.stringify(report, null, 2)}\n`));
    },
  ],
];

const TERRAFORM_SHAPE_SUITES = [
  terraformShape('lambda-terraform-json', [['flow.post-items.tree.txt', 'POST /items']]),
  terraformShape('lambda-terraform-openapi', [
    ['flow.post-returns.tree.txt', 'POST /returns'],
    ['flow.get-loan.tree.txt', 'GET /loans/:param'],
  ]),
  terraformShape('lambda-terraform-websocket', [['flow.ask-librarian.tree.txt', 'event:websocket/library-reading-room/askLibrarian']]),
  terraformShape('lambda-terraform-base-paths', [['flow.check-item.tree.txt', 'invoke:library-kiosk-check-item']]),
  terraformShape('lambda-terraform-bus-forward', [['flow.renew-loan.tree.txt', 'POST /loans/:param/renewals']]),
  terraformShape('lambda-terraform-bucket-notification', [
    ['flow.upload-cover.tree.txt', 'POST /covers/:param'],
    ['flow.make-thumbnail.tree.txt', 'invoke:library-make-thumbnail'],
  ]),
  terraformShape('lambda-terraform-table-stream', [
    ['flow.cancel-order.tree.txt', 'POST /orders/:param/cancel'],
    ['flow.track-click.tree.txt', 'POST /clicks'],
    ['flow.fulfil-order.tree.txt', 'workflow:shop-fulfil-order'],
  ]),
  terraformShape('lambda-terraform-other-ways-in', [
    ['flow.shelf-weight.tree.txt', 'event:iot/library/shelves/+/weight'],
    ['flow.book-returned.tree.txt', 'event:iot/library/returns/+/dropped'],
  ]),
  terraformShape('lambda-terraform-destinations', [
    ['flow.kiosk.tree.txt', 'invoke:library-lending-kiosk'],
    ['flow.return-item.tree.txt', 'invoke:library-lending-return-item'],
  ]),
  terraformShape('lambda-terraform-shared-paths', [['flow.status-board.tree.txt', 'invoke:library-branch-kiosk-status-board']]),
  terraformShape('lambda-terraform-bucket-module', [
    ['flow.withdraw-page.tree.txt', 'invoke:library-scans-withdraw-page'],
    ['flow.import-batch.tree.txt', 'invoke:library-scans-import-batch'],
  ]),
];

/**
 * Sets of recordings, in several places.
 *
 * The first owns its folder, so an answer nobody asks for any more is swept
 * away with it. The second sits in a fixture directory full of other files, so
 * it is written into rather than over.
 */
const SUITES = [
  { dir: outDir, owned: true, cases: CASES },
  { dir: contractsFixture, owned: false, cases: CONTRACT_CASES },
  { dir: doctorFixture, owned: false, cases: DOCTOR_CASES },
  { dir: foldedFixture, owned: false, cases: FOLDED_CASES },
  { dir: hollowFixture, owned: false, cases: HOLLOW_CASES },
  { dir: socketFixture, owned: false, cases: SOCKET_CASES },
  { dir: lambdaFixture, owned: false, cases: LAMBDA_CASES },
  { dir: join(workflowsFixture, 'expected.cli'), owned: true, cases: WORKFLOW_CASES },
  { dir: join(deployedWorkflowsFixture, 'expected.cli'), owned: true, cases: DEPLOYED_WORKFLOW_CASES },
  { dir: join(multiRepoWorkflowsFixture, 'expected.cli'), owned: true, cases: MULTI_REPO_WORKFLOW_CASES },
  { dir: join(lambdaTracesFixture, 'expected.cli'), owned: true, cases: LAMBDA_TRACE_CASES },
  { dir: join(root, 'fixtures', 'eventbridge-terraform', 'expected.cli'), owned: true, cases: EVENT_CASES },
  { dir: join(root, 'fixtures', 'sqs-sns-terraform', 'expected.cli'), owned: true, cases: QUEUE_CASES },
  { dir: join(root, 'fixtures', 'multi-repo-events', 'expected.cli'), owned: true, cases: MULTI_EVENT_CASES },
  { dir: join(root, 'fixtures', 'lambda-namespace-handlers', 'expected.cli'), owned: true, cases: NAMESPACE_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-sdk', 'expected.cli'), owned: true, cases: SDK_START_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-helper', 'expected.cli'), owned: true, cases: HELPER_START_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-by-record', 'expected.cli'), owned: true, cases: RECORD_START_CASES },
  { dir: join(root, 'fixtures', 'aws-sdk-publishers', 'expected.cli'), owned: true, cases: SDK_PUBLISHER_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-function-helper', 'expected.cli'), owned: true, cases: FUNCTION_START_CASES },
  { dir: join(root, 'fixtures', 'lambda-workspace-root', 'expected.cli'), owned: true, cases: WORKSPACE_ROOT_CASES },
  { dir: join(root, 'fixtures', 'sqs-environment-fallback', 'expected.cli'), owned: true, cases: FALLBACK_CASES },
  { dir: join(root, 'fixtures', 'cant-follow', 'expected.cli'), owned: true, cases: CANT_FOLLOW_CASES },
  { dir: join(root, 'fixtures', 'uninstalled-internal-packages', 'expected.cli'), owned: true, cases: STAND_IN_CASES },
  { dir: join(root, 'fixtures', 'nest-check-through-helper', 'expected.cli'), owned: true, cases: HELPER_CHECK_CASES },
  { dir: join(root, 'fixtures', 'tables-set-elsewhere', 'expected.cli'), owned: true, cases: TABLES_ELSEWHERE_CASES },
  { dir: join(root, 'fixtures', 'loops-worth-fixing', 'expected.cli'), owned: true, cases: LOOPS_CASES },
  { dir: join(root, 'fixtures', 'multi-repo-dead-routes', 'expected.cli'), owned: true, cases: DEAD_ROUTE_CASES },
  { dir: join(root, 'fixtures', 'house-patterns', 'expected.cli'), owned: true, cases: HOUSE_CASES },
  { dir: join(root, 'fixtures', 'multi-repo-diff', 'expected.cli'), owned: true, cases: DIFF_CASES },
  ...TERRAFORM_SHAPE_SUITES,
];

/**
 * What legitimately differs between two runs, or between two machines.
 *
 * The timestamp is the obvious one. The other is every absolute path: a health
 * check names the file it wrote and the baseline it read, which is what a person
 * wants and is different in every checkout.
 */
const stable = (text) =>
  text
    .replace(/"generatedAt": "[^"]+"/, '"generatedAt": "1970-01-01T00:00:00.000Z"')
    .split(root)
    .join('<root>');

for (const suite of SUITES) {
  if (update && suite.owned) {
    rmSync(suite.dir, { recursive: true, force: true });
    mkdirSync(suite.dir, { recursive: true });
  }
}

const problems = [];
let compared = 0;

for (const { dir: outDir, cases: CASES } of SUITES) {
for (const [file, ask] of CASES) {
  let stdout = '';
  let stderr = '';
  const io = { out: (text) => (stdout += text), err: (text) => (stderr += text), tty: false };
  try {
    await ask(io);
  } catch (error) {
    problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  // Anything said on stderr is part of the answer, so it is recorded too.
  const actual = stable(stderr === '' ? stdout : `${stdout}--- stderr ---\n${stderr}`);
  const path = join(outDir, file);

  if (update) {
    writeFileSync(path, actual);
    continue;
  }
  let expected;
  try {
    expected = readFileSync(path, 'utf8');
  } catch {
    problems.push(`${file}: no snapshot; run node scripts/cli-snapshots.mjs --update`);
    continue;
  }
  compared += 1;
  if (expected !== actual) problems.push(`${file}: output differs from the snapshot`);
}
}

if (diffProject !== undefined) rmSync(diffProject.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

for (const { dir, owned, cases } of SUITES) {
  if (update || !owned) continue;
  let recorded = [];
  try {
    recorded = readdirSync(dir);
  } catch {
    recorded = [];
  }
  const wanted = new Set(cases.map(([file]) => file));
  for (const file of recorded) {
    if (!wanted.has(file)) problems.push(`${file}: snapshot for a question nobody asks any more`);
  }
}

const total = SUITES.reduce((count, suite) => count + suite.cases.length, 0);

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${total} cli snapshot(s)` : `cli snapshots ok: ${compared} compared`);
