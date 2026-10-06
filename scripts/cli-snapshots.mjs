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
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runChannel,
  runContracts,
  runDoctorCommand,
  runFlow,
  runImpact,
  runStats,
  runTypes,
} from '../packages/cli/dist/index.js';

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

/** One question per file, named for what it asks and how it is drawn. */
const CASES = [
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
 * into each handler, and these are what show that it does. The impact with
 * entry points only is the exception, because a walk back up is not lengthened
 * by the workflows it passes through, and the chain from a handler up to the
 * checkout that starts its workflow is longer than eight hops.
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
    (io) =>
      runImpact('members#src/handlers/send-notice.ts:handler', { ...multiRepoWorkflowsPlain, format: 'tree', depth: '16', entriesOnly: true }, io),
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
 * consumer whose handler cannot be read, which the path counts.
 */
const namespacePlain = plainFor('lambda-namespace-handlers');

const NAMESPACE_CASES = [
  ['flow.post-loans.tree.txt', (io) => runFlow('POST /loans', { ...namespacePlain, format: 'tree' }, io)],
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
  { dir: join(root, 'fixtures', 'eventbridge-terraform', 'expected.cli'), owned: true, cases: EVENT_CASES },
  { dir: join(root, 'fixtures', 'sqs-sns-terraform', 'expected.cli'), owned: true, cases: QUEUE_CASES },
  { dir: join(root, 'fixtures', 'multi-repo-events', 'expected.cli'), owned: true, cases: MULTI_EVENT_CASES },
  { dir: join(root, 'fixtures', 'lambda-namespace-handlers', 'expected.cli'), owned: true, cases: NAMESPACE_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-sdk', 'expected.cli'), owned: true, cases: SDK_START_CASES },
  { dir: join(root, 'fixtures', 'start-workflow-helper', 'expected.cli'), owned: true, cases: HELPER_START_CASES },
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
    ask(io);
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
