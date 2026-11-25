#!/usr/bin/env node
/**
 * Records what the server answers for a fixed set of questions.
 *
 *   node scripts/mcp-snapshots.mjs [--update]
 *
 * The tool tests assert behaviour; these snapshots hold the exact wire shape,
 * which is what every later phase renders from. A change here is a change other
 * packages will see, so it should be read before it is accepted.
 *
 * Three `describe_for_prompt` answers are also written as Markdown under
 * `fixtures/multi-repo/expected.prompt/` (P97): the page's "Copy as prompt"
 * must write exactly those files too, and the CLI's parity test checks it.
 *
 * The questions about a branch (P96) are asked of `fixtures/multi-repo-diff`,
 * made into a project with history, built and diffed first
 * (`diff-fixture.mjs`); so are the prompts and resources the server lists. A
 * case whose tool starts with `#` asks the client that, not a tool.
 *
 * `tools.listed` records, per project, the names of the tools the server
 * lists for it as it is (P201: `auto`, the default): what the project can
 * answer with the options the suite hands the server, so a fixture that
 * gains an observed file, a rule or a channel shows the tools it gains. The
 * whole list (`all`) is the same twenty-seven names for every fixture and is
 * held by the tool tests, with its size.
 *
 * Every question is asked with `verbose: true` (P365), so these hold the whole
 * answer, as they did before answers were compacted. The `expected.mcp.compact`
 * suites ask a few of the same questions with `verbose: false`: the answer an
 * agent is handed, each fact its ids already say left out.
 */
import { isDeepStrictEqual } from 'node:util';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer, DbHandle } from '@flowatlas/mcp';
import { loadConfig } from '@flowatlas/core';
import { changeCheckerFor, editContextFor, missingCandidatesFor, reasonCatalog, testPatternText, trafficHook } from '../packages/cli/dist/index.js';
import { diffFixtureProject } from './diff-fixture.mjs';
import { editedFixtureProject } from './edit-fixture.mjs';
import { checkedDeployedProject } from './deployed-fixture.mjs';
import { readGraphFile, resolveNodeId } from './fixture-nodes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures', 'multi-repo');
const outDir = join(fixture, 'expected.mcp');
const update = process.argv.includes('--update');

// The two questions below are about a particular request, and a request's id
// carries the line it was written at. Asked for by the client method that makes
// it, so that a fixture can gain a line without this script needing an edit.
const graph = readGraphFile(join(fixture, '.flowatlas', 'project-graph.json'));
const requestIn = (method) => resolveNodeId(graph, { type: 'http_out', calledBy: method });

/** One question per file, named for what it asks. */
const CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['list_entries.all', 'list_entries', {}],
  ['list_entries.by-service', 'list_entries', { service: 'orders' }],
  ['list_entries.truncated', 'list_entries', { maxNodes: 3 }],
  ['get_flow.cross-service', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', depth: 8 }],
  ['get_flow.truncated', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxNodes: 5 }],
  ['get_flow.ambiguous', 'get_flow', { entry: 'GET /orders/1' }],
  ['get_flow.dead-end', 'get_flow', { entry: 'entry:gateway:http:POST:/orders/:param/cancel', detail: 2 }],
  // The two flows P92 measures by, asked with the defaults: each reaches billing.
  ['get_flow.post-orders', 'get_flow', { entry: 'POST /orders' }],
  ['get_flow.invoice', 'get_flow', { entry: 'POST /orders/:param/invoice' }],
  ['who_calls.cross-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6 }],
  ['impact.service-method', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  ['who_emits.order-created', 'who_emits', { channel: 'order.created' }],
  ['who_consumes.order-created', 'who_consumes', { channel: 'order.created' }],
  ['who_consumes.no-handler', 'who_consumes', { channel: 'order.archived' }],
  ['get_type.shared', 'get_type', { type: 'type:@fx/contracts#OrderDto' }],
  ['get_type.ambiguous', 'get_type', { type: 'InvoiceDto' }],
  ['check_contract.shared', 'check_contract', {
    from: requestIn('gateway#src/clients/orders.client.ts:OrdersClient.fetchOne'),
    to: 'entry:orders:http:GET:/orders/:param',
  }],
  ['check_contract.hash-differs', 'check_contract', {
    from: requestIn('gateway#src/clients/billing.client.ts:BillingClient.requestInvoice'),
    to: 'entry:billing:http:POST:/invoices',
  }],
  ['find_symbol.partial', 'find_symbol', { query: 'fetchOne' }],
  ['start_here.all', 'start_here', {}],
  ['start_here.by-service', 'start_here', { service: 'gateway' }],
  ['who_calls.by-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6, service: 'gateway' }],
  ['describe_for_prompt.entry', 'describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/cancel' }],
  ['describe_for_prompt.channel', 'describe_for_prompt', { id: 'order.created' }],
  ['cant_follow.all', 'cant_follow', {}],
  ['cant_follow.by-service', 'cant_follow', { service: 'gateway' }],
  ['describe_for_prompt.symbol', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  // The three subjects the page's "Copy as prompt" is checked against (P97).
  ['describe_for_prompt.invoice', 'describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/invoice' }],
  ['describe_for_prompt.gap', 'describe_for_prompt', { id: 'gap:web|src/app/orders-api.service.ts|api-path-dynamic' }],
  // Answers that say where they stopped (P94): a caller tree drawn to a depth,
  // every way in past it listed all the same (P379), a
  // route said with a real value, a literal segment beside a hole, every
  // crossing between two services, and a channel that does not exist.
  ['who_calls.depth-drawn', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 2 }],
  ['who_calls.concrete-path', 'who_calls', { symbol: 'GET /orders/123' }],
  ['get_flow.literal-route', 'get_flow', { entry: 'GET /orders/latest', maxNodes: 8 }],
  ['check_contract.between-services', 'check_contract', { from: 'gateway', to: 'billing' }],
  ['who_emits.unknown-channel', 'who_emits', { channel: 'order.create' }],
  // Is it dead, what to look at, who uses a type, and a whole class, file or
  // service as one text (P95): a route nothing calls, one a call read in part
  // could reach, one a call one segment off names, a service's rows; every
  // finding counted; a shared type, a name two types have, a type only other
  // types hold; and a class answered for by its methods.
  ['dead.route', 'dead', { id: 'entry:billing:http:GET:/invoices/:param' }],
  ['dead.likely', 'dead', { id: 'GET /orders/latest' }],
  ['dead.one-off', 'dead', { id: 'entry:orders:http:POST:/orders/:param/archive' }],
  ['dead.alive', 'dead', { id: 'orders#src/orders/orders.service.ts:OrdersService' }],
  ['dead.by-service', 'dead', { service: 'orders' }],
  ['findings.all', 'findings', {}],
  ['findings.unguarded', 'findings', { kind: 'unguarded', maxNodes: 2 }],
  ['type_usage.order-dto', 'type_usage', { type: 'type:@fx/contracts#OrderDto' }],
  ['type_usage.ambiguous', 'type_usage', { type: 'OrderDto' }],
  ['type_usage.nested', 'type_usage', { type: 'Money' }],
  ['describe_for_prompt.class', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService', scope: 'class' }],
  ['describe_for_prompt.file', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts', scope: 'file' }],
  ['describe_for_prompt.service', 'describe_for_prompt', { id: 'orders', scope: 'service' }],
  ['describe_for_prompt.wrong-scope', 'describe_for_prompt', { id: 'POST /orders', scope: 'class' }],
  ['who_calls.class', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService', depth: 1 }],
  ['impact.class', 'impact', { symbol: 'OrdersService' }],
  // The pages that describe what was asked about (P120), from the docs.json `flowatlas docs` wrote.
  ['describe_for_prompt.documented', 'describe_for_prompt', { id: 'entry:gateway:http:GET:/orders/:param', maxSteps: 3 }],
  ['impact.documented', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.create' }],
  // The documents `flowatlas spec` writes (P118): a whole one, one route,
  // one channel end found without its kind, a cut one, and a route's prompt
  // with its fragment.
  ['get_spec.orders', 'get_spec', { service: 'orders' }],
  ['get_spec.one-route', 'get_spec', { service: 'orders', path: 'POST /orders' }],
  ['get_spec.channel', 'get_spec', { service: 'billing', path: 'order.created' }],
  ['get_spec.cut', 'get_spec', { service: 'gateway', maxChars: 600 }],
  ['describe_for_prompt.with-spec', 'describe_for_prompt', { id: 'entry:orders:http:POST:/orders', withSpec: true, maxChars: 20000 }],
];

/**
 * A throw through a helper (P90): the lending desk of
 * `fixtures/nest-check-through-helper`, whose failures name the helper with
 * what it can choose, and whose prompt says it in one line.
 */
const HELPER_CASES = [
  ['get_flow.renewals', 'get_flow', { entry: 'POST /desk/renewals' }],
  ['get_flow.overdue', 'get_flow', { entry: 'GET /desk/overdue' }],
  ['describe_for_prompt.renewals', 'describe_for_prompt', { id: 'POST /desk/renewals' }],
  ['search.fails-423', 'search', { query: '423', kinds: ['fails'] }],
];

/**
 * Types of message on one channel (P358): the handlers that select a type,
 * a type selected only in a class nothing builds, the publishes of a type,
 * and a type found by its value.
 */
const MESSAGE_TYPE_CASES = [
  ['who_consumes.type', 'who_consumes', { channel: 'space:<spaceId>:events', type: 'MEMBER_JOINED' }],
  ['who_consumes.unselected', 'who_consumes', { channel: 'space:*:events', type: 'QUOTA_WARNING' }],
  ['who_emits.type-unread', 'who_emits', { channel: 'space:*:events', type: 'DOC_ARCHIVED' }],
  ['search.message', 'search', { query: 'QUOTA_WARNING' }],
];

/**
 * A type published through the project's bus, relayed by a per-board hub onto
 * stream routes, and chosen by screens subscribed through an rxjs wrapper
 * (P362): the screens that select a type, one selected only through a stream
 * service nothing injects, one no screen selects, the channel's consumers, a
 * type chosen through another service's re-exposing method, and one chosen
 * through one instance of a generic stream class.
 */
const HUB_SUBJECT_CASES = [
  ['who_consumes.type-filter', 'who_consumes', { channel: 'board:<boardId>:events', type: 'CARD_MOVED' }],
  ['who_consumes.type-set', 'who_consumes', { channel: 'board:*:events', type: 'CARD_ARCHIVED' }],
  ['who_consumes.unselected', 'who_consumes', { channel: 'board:*:events', type: 'CARD_COMMENTED' }],
  ['who_consumes.unreached', 'who_consumes', { channel: 'board:*:events', type: 'BOARD_RENAMED' }],
  ['who_consumes.channel', 'who_consumes', { channel: 'board:*:events' }],
  // Through another service's method, cast, the type read in brackets.
  ['who_consumes.type-re-exposed', 'who_consumes', { channel: 'board:*:events', type: 'CARD_ADDED' }],
  // Through one instance of a generic stream class, on the channel the routing table hands the hub.
  ['who_consumes.type-generic-stream', 'who_consumes', { channel: 'crew:<crewId>:shifts', type: 'CREW_ASSIGNED' }],
  // The trap: a type handed to a helper that works the channel out inside is no channel, and no publish read carries it.
  ['who_consumes.trap-type', 'who_consumes', { channel: 'board:*:events', type: 'CARD_PINNED' }],
  ['who_consumes.trap-channel', 'who_consumes', { channel: 'CARD_PINNED' }],
  // Published only by a direct call to the project's own bus, which no broker description names.
  ['who_consumes.helper-publish', 'who_consumes', { channel: 'board:*:orders', type: 'SCHEDULED_ALERT' }],
  ['who_emits.helper-publish', 'who_emits', { channel: 'board:*:orders', type: 'SCHEDULED_ALERT' }],
  // The screens are joined to every channel the hub relays (P395): a type chosen is checked against all of them, held back where one is not read whole.
  ['findings.type-never-published', 'findings', { kind: 'type-never-published' }],
];

/**
 * The answer an agent is handed (P365): questions the suites above ask with
 * `verbose: true`, asked compact, so the two can be read side by side. On the
 * main fixture the tools an agent calls most: a flow, the callers and the ways
 * in of a method, a cut list and its paging call, a name, a verdict, a
 * channel's ends and a description at `detail: 2`.
 */
const COMPACT_CASES = [
  ['get_flow.cross-service', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', depth: 8, verbose: false }],
  ['who_calls.cross-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6, verbose: false }],
  ['who_calls.to-ways-in', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', verbose: false }],
  ['impact.service-method', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', verbose: false }],
  ['list_entries.truncated', 'list_entries', { maxNodes: 3, verbose: false }],
  ['find_symbol.partial', 'find_symbol', { query: 'fetchOne', verbose: false }],
  ['search.orders', 'search', { query: 'orders', verbose: false }],
  ['dead.service', 'dead', { service: 'gateway', verbose: false }],
  ['who_consumes.order-created', 'who_consumes', { channel: 'order.created', detail: 2, verbose: false }],
  ['who_emits.order-created', 'who_emits', { channel: 'order.created', verbose: false }],
  // Its Markdown as plain text (P382), recorded as `{text}`.
  ['describe_for_prompt.entry', '#callText', { name: 'describe_for_prompt', arguments: { id: 'entry:orders:http:POST:/orders' } }],
];

/** Message types chosen by screens' handlers through a stream wrapper, compact (P365), at both levels of detail. */
const HUB_SUBJECT_COMPACT_CASES = [
  ['who_consumes.type-filter', 'who_consumes', { channel: 'board:<boardId>:events', type: 'CARD_MOVED', verbose: false }],
  ['who_consumes.type-filter-detail', 'who_consumes', { channel: 'board:*:events', type: 'CARD_MOVED', detail: 2, verbose: false }],
  ['who_consumes.channel', 'who_consumes', { channel: 'board:*:events', verbose: false }],
  ['search.message', 'search', { query: 'CARD_MOVED', verbose: false }],
];

/** Screens the router registers, compact (P365): the ways in of a routed component, its verdict, and a screen found by address. */
const SCREEN_COMPACT_CASES = [
  ['list_entries.screens', 'list_entries', { kind: 'screen', verbose: false }],
  ['who_calls.routed', 'who_calls', { symbol: 'angular-basic#src/app/reports.component.ts:ReportsComponent', verbose: false }],
  ['impact.routed', 'impact', { symbol: 'angular-basic#src/app/profile.component.ts:ProfileComponent', verbose: false }],
  ['dead.routed', 'dead', { id: 'angular-basic#src/app/settings.component.ts:SettingsComponent', verbose: false }],
  ['search.screen', 'search', { query: '/reports', verbose: false }],
];

/**
 * Every way in that could break, in one impact call, and reach that never
 * hides a maybe (P367): a back end's method a screen and a bot reach through
 * one route, the bot's handler behind the unread call its loop of routes
 * makes, and a webhook that calls the method directly.
 */
const CALLING_SIDE_TARGET = 'shop-api#src/orders.service.ts:OrdersService.updateStatus';
const CALLING_SIDE_CASES = [
  ['impact.calling-side', 'impact', { symbol: CALLING_SIDE_TARGET }],
  ['impact.detail-2', 'impact', { symbol: CALLING_SIDE_TARGET, detail: 2 }],
  ['impact.route', 'impact', { symbol: 'entry:shop-api:http:PATCH:/orders/status' }],
  ['who_calls.bot-chain', 'who_calls', { symbol: CALLING_SIDE_TARGET, depth: 8 }],
  ['dead.bot-handler', 'dead', { id: 'ops-bot#src/ops-bot.ts:OpsBot.handleStatus' }],
];
/**
 * Every way in counted by what it is (P396): a bot's webhook handled by the
 * bot's class is a bot, a maybe row of another bot is a bot marked maybe, and
 * `changing` holds the API alone; `dead` on the maybe handler says `maybe`
 * with the gap impact names.
 */
const BOT_WEBHOOK_TARGET = 'shop-api#src/orders.service.ts:OrdersService.updateStatus';
const BOT_WEBHOOK_CASES = [
  ['impact.bot-webhook', 'impact', { symbol: BOT_WEBHOOK_TARGET }],
  ['dead.maybe-handler', 'dead', { id: 'courier-bot#src/courier-bot.ts:CourierBot.handleDelivered' }],
];
const BOT_WEBHOOK_COMPACT_CASES = [
  ['impact.bot-webhook', 'impact', { symbol: BOT_WEBHOOK_TARGET, verbose: false }],
  ['dead.maybe-handler', 'dead', { id: 'courier-bot#src/courier-bot.ts:CourierBot.handleDelivered', verbose: false }],
];

/** The same impact, compact (P365), at both levels of detail: what an agent is handed. */
const CALLING_SIDE_COMPACT_CASES = [
  ['impact.calling-side', 'impact', { symbol: CALLING_SIDE_TARGET, verbose: false }],
  ['impact.detail-2', 'impact', { symbol: CALLING_SIDE_TARGET, detail: 2, verbose: false }],
];

/**
 * A child component a routed screen renders by its tag, a click handing a
 * loop's element to a method that navigates, and client methods nothing calls
 * whose names the repository writes nowhere else, one in a file with a step
 * the reading could not follow (P370).
 */
const RENDERED_REACH_TARGET = 'catalog-api#src/items.service.ts:ItemsService.findOne';
const RENDERED_REACH_CASES = [
  ['impact.rendered-child', 'impact', { symbol: RENDERED_REACH_TARGET }],
  [
    'dead.components',
    'dead',
    {
      ids: [
        'catalog-web#src/app/item-card.component.ts:ItemCardComponent',
        'catalog-web#src/app/legacy-badge.component.ts:LegacyBadgeComponent',
        'catalog-web#src/app/promo-dialog.component.ts:PromoDialogComponent',
        'catalog-web#src/app/settings-page.component.ts:SettingsPageComponent',
      ],
    },
  ],
  ['find_symbol.unreferenced', 'find_symbol', { queries: ['oneLegacy', 'byKey'] }],
  ['who_calls.menu-screen', 'who_calls', { symbol: 'catalog-web#src/app/reports-page.component.ts:ReportsPageComponent' }],
];
/**
 * A front-end client injected by screens that call other methods of it, and
 * screens whose stream subscriptions call the method (P371): impact lists the
 * screens that call it, never the routes that publish to the channel those
 * subscriptions listen on, the screens behind them, or a screen that injects
 * the client for something else; a request a catch-all answers stays apart.
 */
const SHARED_CLIENT_ITEMS = 'market-api#src/items.service.ts:ItemsService.listByShop';
const SHARED_CLIENT_DESKS = 'market-api#src/desks.service.ts:DesksService.ackCall';
const SHARED_CLIENT_CASES = [
  ['impact.items', 'impact', { symbol: SHARED_CLIENT_ITEMS }],
  ['impact.desks', 'impact', { symbol: SHARED_CLIENT_DESKS }],
  ['impact.stream-connect', 'impact', { symbol: 'market-web#src/app/shop-events.service.ts:ShopEventsService.connect' }],
  ['impact.catch-all', 'impact', { symbol: 'entry:market-api:http:ALL:/api/*' }],
  ['who_calls.shared-client', 'who_calls', { symbol: 'market-web#src/app/items.client.ts:ItemsClient.getHistory', depth: 2 }],
  ['find_symbol.ways', 'find_symbol', { queries: ['getHistory', 'StaffBoardService.ackCall', 'ShopEventsService.connect'] }],
];
/** The two impacts, compact: what an agent is handed. */
const SHARED_CLIENT_COMPACT_CASES = [
  ['impact.items', 'impact', { symbol: SHARED_CLIENT_ITEMS, verbose: false }],
  ['impact.desks', 'impact', { symbol: SHARED_CLIENT_DESKS, verbose: false }],
];

/**
 * Navigations, guards and a channel a bot re-fetches on (P372): impact never
 * walks back along a navigation or from a guard to the screens it guards, and
 * says what lies only beyond a channel apart, in `throughChannels`, one call
 * listing it; a guard's own code reaches the screens it guards.
 */
const GUARDED_ITEMS = 'store-api#src/items.service.ts:ItemsService.listByShop';
const GUARDED_TICKETS = 'store-api#src/tickets.service.ts:TicketsService.acknowledge';
const GUARDED_BOT = 'consumer:store-bot#src/store-bot.ts:StoreBot.onStatusEvent';
const GUARDED_CASES = [
  ['impact.items', 'impact', { symbol: GUARDED_ITEMS }],
  ['impact.tickets', 'impact', { symbol: GUARDED_TICKETS }],
  ['impact.items-across-channel', 'impact', { symbol: GUARDED_ITEMS, channel: 'shop:*:orders' }],
  ['impact.guard-own-code', 'impact', { symbol: 'store-web#src/app/auth.service.ts:AuthService.role' }],
  ['find_symbol.navigated', 'find_symbol', { queries: ['DashboardComponent.loadData', 'TicketBoardComponent.routeAction', 'StoreBot.onStatusEvent'] }],
  // The bot takes messages from three channels: one row of throughChannels, its ways in each once, listed by the consumer (P378).
  ['impact.items-across-consumer', 'impact', { symbol: GUARDED_ITEMS, channel: GUARDED_BOT }],
  ['who_calls.items', 'who_calls', { symbol: GUARDED_ITEMS }],
];
/** The two impacts and the channel's list, compact: what an agent is handed. */
const GUARDED_COMPACT_CASES = [
  ['impact.items', 'impact', { symbol: GUARDED_ITEMS, verbose: false }],
  ['impact.tickets', 'impact', { symbol: GUARDED_TICKETS, verbose: false }],
  ['impact.items-across-channel', 'impact', { symbol: GUARDED_ITEMS, channel: 'shop:*:orders', verbose: false }],
  ['impact.items-across-consumer', 'impact', { symbol: GUARDED_ITEMS, channel: GUARDED_BOT, verbose: false }],
  ['who_calls.items', 'who_calls', { symbol: GUARDED_ITEMS, verbose: false }],
];

/**
 * What a pilot on a real project got wrong after P368-P373 (P374): impact's
 * rows name the code that handles each way in (`by`: a route's handler, the
 * bot class a worker's webhook hands its update to, a screen's component); a
 * guard reads a body field through a key it holds as a default; a branch
 * toasting a field is handled where it is written, and a consumer whose
 * subscription is made in a class nothing builds never runs; a subscriber to
 * every channel draws its type only where a publish sends it.
 */
const HANDLING_CANCEL = 'shop-api#src/orders/orders.service.ts:OrdersService.cancel';
const HANDLING_CASES = [
  ['impact.cancel', 'impact', { symbol: HANDLING_CANCEL }],
  ['check_contract.default-key', 'check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef' }],
  ['check_contract.unread-in-method', 'check_contract', { edge: 'PATCH /api/orders/:id/note' }],
  ['who_consumes.never-subscribed', 'who_consumes', { channel: 'desk_alerts', type: 'HELP_REQUESTED' }],
  ['who_consumes.channel', 'who_consumes', { channel: 'desk_alerts' }],
  ['search.every-channel-type', 'search', { query: 'HELP_REQUESTED' }],
  // A controller's routes, each judged, and the two no code calls, in one small call (P375).
  ['dead.class-routes', 'dead', { id: 'ReportsController' }],
  ['list_entries.class-uncalled', 'list_entries', { in: 'ReportsController', reach: 'dead' }],
];
/** The impact, the guard's read and the consumers, compact: what an agent is handed. */
const HANDLING_COMPACT_CASES = [
  ['impact.cancel', 'impact', { symbol: HANDLING_CANCEL, verbose: false }],
  ['check_contract.default-key', 'check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef', verbose: false }],
  ['who_consumes.never-subscribed', 'who_consumes', { channel: 'desk_alerts', type: 'HELP_REQUESTED', verbose: false }],
  ['search.every-channel-type', 'search', { query: 'HELP_REQUESTED', verbose: false }],
  // At detail 2 the rows keep their plain facts, the target all of its own (P375).
  ['impact.cancel-detail-2', 'impact', { symbol: HANDLING_CANCEL, detail: 2, verbose: false }],
  ['dead.class-routes', 'dead', { id: 'ReportsController', verbose: false }],
  ['list_entries.class-uncalled', 'list_entries', { in: 'ReportsController', reach: 'dead', verbose: false }],
];

/**
 * who_calls walked to the ways in (P376): a method whose report route is five
 * calls down, the class whose four methods share callers, and two of its
 * methods asked together; and the same method with a depth, the tree drawn to
 * it and every way in past it all the same (P379). A controller's routes asked
 * together (P379): each one's direct callers, front-end requests, one carrying
 * a body typed inline with 22 fields, and the ways in said once; the
 * routes listed by their controller, each with who calls it.
 */
const CALLERS_STOCK = 'stock-api#src/stock/stock.service.ts:StockService';
const CALLERS_ROUTES = [
  'entry:stock-api:http:GET:/products',
  'entry:stock-api:http:GET:/products/:param',
  'entry:stock-api:http:POST:/products',
  'entry:stock-api:http:PUT:/products/:param',
  'entry:stock-api:http:DELETE:/products/:param',
];
const CALLERS_CASES = [
  ['who_calls.to-ways-in', 'who_calls', { symbol: `${CALLERS_STOCK}.level` }],
  ['who_calls.class', 'who_calls', { symbol: CALLERS_STOCK }],
  ['who_calls.several', 'who_calls', { symbols: [`${CALLERS_STOCK}.reserve`, `${CALLERS_STOCK}.restock`] }],
  ['who_calls.depth-drawn', 'who_calls', { symbol: `${CALLERS_STOCK}.level`, depth: 3 }],
  ['who_calls.routes', 'who_calls', { symbols: CALLERS_ROUTES }],
  ['who_calls.routes-depth', 'who_calls', { symbols: CALLERS_ROUTES, depth: 1 }],
  ['get_flow.inline-type', 'get_flow', { entry: 'CatalogComponent.add', detail: 2 }],
  ['list_entries.class-callers', 'list_entries', { in: 'ProductsController' }],
];
/** The same, compact: what an agent is handed. */
const CALLERS_COMPACT = new Set(['who_calls.to-ways-in', 'who_calls.class', 'who_calls.several', 'who_calls.routes', 'get_flow.inline-type', 'list_entries.class-callers']);
const CALLERS_COMPACT_CASES = CALLERS_CASES.filter(([name]) => CALLERS_COMPACT.has(name)).map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);

/**
 * "Where does this request land" in one call (P377): get_flow on a front-end
 * method's short name, who_calls, find_symbol and get_source saying where a
 * method's requests land (one joined to no route among them), search with
 * the client's parameter names and no global prefix, and a service named by
 * its repository's folder, or by nothing the configuration says.
 */
const REQUEST_CASES = [
  ['get_flow.short-name', 'get_flow', { entry: 'CatalogService.getGrouped' }],
  ['get_flow.ambiguous-name', 'get_flow', { entry: 'CatalogService' }],
  ['who_calls.request-lands', 'who_calls', { symbol: 'CatalogService.getGrouped' }],
  ['find_symbol.request-lands', 'find_symbol', { query: 'DeskOrderService.amendOrder' }],
  ['get_source.request-unjoined', 'get_source', { symbol: 'CatalogService.exportSheet' }],
  ['search.client-path', 'search', { query: '/admin/:rid/orders/${id}/modify', kinds: ['routes'] }],
  ['search.folder-name', 'search', { query: 'modify', kinds: ['routes'], service: 'shop-backend' }],
  ['search.unknown-service', 'search', { query: 'modify', service: 'backend' }],
];
/** The same, compact: what an agent is handed. */
const REQUEST_COMPACT_CASES = REQUEST_CASES.filter(([name]) => !name.startsWith('get_source')).map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);

/**
 * Answers never falsely complete (P381): a route two services serve said
 * aloud, with and without the service that picks it; `callersIn`; a name
 * nothing holds; impact by kind and on several symbols; code called only
 * through a dead route; a controller's uncalled routes; and the uncalled ways
 * in a `reach: "dead"` list leaves out.
 */
const PICKED_API_ROUTE = 'entry:lending-api:http:GET:/books/:param';
const PICKED_CASES = [
  ['who_calls.service-picks', 'who_calls', { symbol: 'GET /books/42', service: 'lending-api' }],
  ['who_calls.two-candidates', 'who_calls', { symbol: 'GET /books/42' }],
  ['who_calls.callers-in', 'who_calls', { symbol: PICKED_API_ROUTE, callersIn: 'desk-bot' }],
  ['who_calls.fuzzy', 'who_calls', { symbol: 'BoksService.findOne' }],
  ['who_calls.ids', 'who_calls', { ids: [PICKED_API_ROUTE, 'entry:lending-gateway:http:GET:/books/:param'] }],
  ['impact.service-picks', 'impact', { symbol: PICKED_API_ROUTE, service: 'lending-api' }],
  ['impact.by-kind', 'impact', { symbol: 'BooksService.findOne' }],
  ['impact.symbols', 'impact', { symbols: ['BooksService.findOne', 'HoldsService.place'] }],
  ['dead.through-dead', 'dead', { id: 'HoldsService.release' }],
  ['dead.controller-uncalled', 'dead', { id: 'lending-api#src/books.controller.ts:BooksController' }],
  ['list_entries.dead-not-complete', 'list_entries', { service: 'lending-api', reach: 'dead' }],
  ['list_entries.uncalled', 'list_entries', { service: 'lending-api', called: false }],
];
/** The same, compact: what an agent is handed. */
const PICKED_COMPACT_CASES = PICKED_CASES.map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);
/**
 * One call per question (P382): check_contract on a route said with `route`
 * and another parameter name, on a type of message given as the channel (one
 * channel carries one type, two carry the other), and on inputs that name
 * nothing, each error naming the calls to make; a class's skeleton; a
 * detail-2 flow that says each fact once.
 */
const ONE_CALL_CASES = [
  ['check_contract.route-alias', 'check_contract', { route: 'PATCH /api/orders/:orderId/cancel', field: 'userRef' }],
  ['check_contract.type-as-channel', 'check_contract', { channel: 'ORDER_READY' }],
  ['check_contract.type-on-two-channels', 'check_contract', { channel: 'HELP_REQUESTED' }],
  ['check_contract.nothing-named', 'check_contract', {}],
  ['check_contract.handler-alone', 'check_contract', { from: 'shop-api#src/orders/orders.controller.ts:OrdersController.cancel' }],
  ['check_contract.no-channel', 'check_contract', { channel: 'NO_SUCH_THING' }],
  ['get_source.class-skeleton', 'get_source', { symbol: 'OrdersController' }],
  ['get_flow.detail-2-once', 'get_flow', { route: 'PATCH /api/orders/:orderId/cancel', detail: 2 }],
];
/**
 * The same, compact: what an agent is handed; get_source and
 * describe_for_prompt as the plain text they answer, recorded as `{text}`.
 */
const ONE_CALL_COMPACT_CASES = [
  ...ONE_CALL_CASES.filter(([name]) => !name.startsWith('get_source')).map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]),
  ['get_source.class-skeleton', '#callText', { name: 'get_source', arguments: { symbol: 'OrdersController' } }],
  ['get_source.method', '#callText', { name: 'get_source', arguments: { symbol: 'OrdersController.addNote' } }],
  ['describe_for_prompt.route', '#callText', { name: 'describe_for_prompt', arguments: { id: 'PATCH /api/orders/:orderId/cancel' } }],
];
/**
 * Search and find_symbol taking a sentence (P383): each name's words indexed
 * once, a query's words ranked, every row with the words it holds, and the
 * answer never complete. A sentence, a word no name holds beside one that
 * does, `OR`, and a name written another way (`cancelOrder`, "order cancel").
 */
const SENTENCE_CASES = [
  ['search.sentence', 'search', { query: 'where is the order cancelled' }],
  ['search.payments-sentence', 'search', { query: 'what handles payments' }],
  ['search.or', 'search', { query: 'cancel OR refund' }],
  ['find_symbol.words', 'find_symbol', { query: 'order cancel' }],
  ['find_symbol.camel-words', 'find_symbol', { query: 'cancelOrder' }],
];
/** The same, compact: what an agent is handed. */
const SENTENCE_COMPACT_CASES = SENTENCE_CASES.map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);
/**
 * Route order (P385): a spelled-out route registered after a parameter route
 * of the same controller, one of a controller registered later, one on an
 * Express router, the two routers whose order is not read, and a service on
 * Fastify, where the spelled-out route answers.
 */
const ROUTE_ORDER_CASES = [
  ['who_calls.shadowed-handler', 'who_calls', { symbol: 'OrdersController.latest' }],
  ['who_calls.shadowing-handler', 'who_calls', { symbol: 'OrdersController.findOne' }],
  ['dead.shadowed-route', 'dead', { id: 'entry:shop-api:http:GET:/orders/latest' }],
  ['dead.shadowed-handler', 'dead', { id: 'OrdersController.latest' }],
  ['find_symbol.request-lands-shadowed', 'find_symbol', { query: 'OrdersApi.exportAll' }],
  ['who_calls.order-unread', 'who_calls', { symbol: 'listNewest' }],
  ['who_calls.fastify', 'who_calls', { symbol: 'InvoicesController.overdue' }],
  ['findings', 'findings', {}],
];
/** The same, compact: what an agent is handed. */
const ROUTE_ORDER_COMPACT_CASES = ROUTE_ORDER_CASES.map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);
/**
 * Which fields of an answer each client reads (P391): a route's answer read
 * by an Angular screen through the async pipe and a child it binds each row
 * to, and by a React list through a query's data and a row's props; one
 * field asked (which screens break if it changes); a field a client reads
 * that the route never answers; a request whose answer is handed whole to a
 * function of the platform; and one request's edge.
 */
const ANSWER_CASES = [
  ['check_contract.answer-route', 'check_contract', { edge: 'GET /api/orders' }],
  ['check_contract.answer-field', 'check_contract', { edge: 'GET /api/orders', field: 'status' }],
  ['check_contract.answer-missing', 'check_contract', { edge: 'GET /api/profile' }],
  ['check_contract.answer-unfollowed', 'check_contract', { edge: 'GET /api/orders/:id' }],
  ['check_contract.answer-edge', 'check_contract', { from: 'ui_api_call:shop-app#src/api.ts:23:26', to: 'entry:shop-api:http:GET:/api/profile' }],
  // A field a client reads that the route never returns, as a finding (P393).
  ['findings.answer-field-never-returned', 'findings', { kind: 'answer-field-never-returned' }],
];
/** The same, compact: what an agent is handed. */
const ANSWER_COMPACT_CASES = ANSWER_CASES.map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);

/** The same impact and a flow through the rendered child, compact (P370). */
const RENDERED_REACH_COMPACT_CASES = [
  ['impact.rendered-child', 'impact', { symbol: RENDERED_REACH_TARGET, verbose: false }],
  ['get_flow.catalog-screen', 'get_flow', { entry: 'entry:catalog-web:screen:/catalog', verbose: false }],
  ['get_flow.catalog-screen-detail-2', 'get_flow', { entry: 'entry:catalog-web:screen:/catalog', detail: 2, verbose: false }],
];

/**
 * Handlers that choose no type in their body, and subscribers to every channel
 * of a bus (P369): a bot's handlers tied to their types by the route calling
 * them under a `switch` and by their parameters' types, a service choosing in a
 * callback on every channel and in the method it hands on to, a handler
 * written in place where it subscribes, and a screen's stream listener written
 * in a hook.
 */
const TYPED_HANDLER_CASES = [
  ['who_consumes.relayed-type', 'who_consumes', { channel: 'order_updates', type: 'ORDER_READY' }],
  // A message type given as the channel: answered on the channel carrying it (P393).
  ['who_consumes.type-as-channel', 'who_consumes', { channel: 'ORDER_READY' }],
  ['who_emits.type-as-channel', 'who_emits', { channel: 'ORDER_READY' }],
  ['who_consumes.parameter-type', 'who_consumes', { channel: 'order_updates', type: 'ORDER_PLACED' }],
  ['who_consumes.caller-wins', 'who_consumes', { channel: 'order_updates', type: 'ORDER_REFUNDED' }],
  ['who_consumes.every-channel', 'who_consumes', { channel: 'desk_alerts', type: 'HELP_REQUESTED' }],
  ['who_consumes.in-place', 'who_consumes', { channel: 'desk_alerts', type: 'DESK_CLOSED' }],
  ['who_consumes.channel', 'who_consumes', { channel: 'desk_alerts' }],
  ['search.message', 'search', { query: 'HELP_REQUESTED' }],
];

const TYPED_HANDLER_COMPACT_CASES = [
  ['who_consumes.relayed-type', 'who_consumes', { channel: 'order_updates', type: 'ORDER_READY', verbose: false }],
  ['search.message', 'search', { query: 'HELP_REQUESTED', verbose: false }],
];

/**
 * Fields read and sent (P368): which handler reads one field of a type of
 * message, which code on a route's path reads one field of the body (a guard,
 * where the handler ignores it), and a type whose handler reads a field its
 * publish does not send; with the detail-2 lists, the whole channel compared
 * type by type, a search by a field's name and the request edge.
 */
const FIELDS_CASES = [
  ['who_consumes.field', 'who_consumes', { channel: 'order_updates', type: 'ORDER_READY', field: 'label' }],
  ['who_consumes.detail-2', 'who_consumes', { channel: 'order_updates', detail: 2 }],
  ['who_emits.field', 'who_emits', { channel: 'order_updates', type: 'ORDER_READY', field: 'label' }],
  ['check_contract.route-field', 'check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef' }],
  ['check_contract.route', 'check_contract', { edge: 'POST /api/orders/:id/ready' }],
  ['check_contract.type', 'check_contract', { channel: 'desk_events', type: 'HELP_REQUESTED' }],
  ['check_contract.channel', 'check_contract', { channel: 'order_updates' }],
  ['search.field', 'search', { query: 'label', kinds: ['fields'] }],
];
/** The three questions compact (P365): what an agent is handed for each, in one call. */
const FIELDS_COMPACT_CASES = [
  ['who_consumes.field', 'who_consumes', { channel: 'order_updates', type: 'ORDER_READY', field: 'label', verbose: false }],
  ['check_contract.route-field', 'check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef', verbose: false }],
  ['check_contract.type', 'check_contract', { channel: 'desk_events', type: 'HELP_REQUESTED', verbose: false }],
];

/**
 * What looks broken between the services (P384): every defect gated on its
 * evidence, with its precision and nearest fix, and what was held back.
 */
const BETWEEN_CASES = [
  ['findings.all', 'findings', {}],
  ['findings.call-to-missing-route', 'findings', { kind: 'call-to-missing-route' }],
  ['findings.field-never-sent', 'findings', { kind: 'field-never-sent' }],
  ['findings.unguarded-among-guarded', 'findings', { kind: 'unguarded-among-guarded' }],
];
/** The same, compact: what an agent is handed. */
const BETWEEN_COMPACT_CASES = [
  ['findings.all', 'findings', { verbose: false }],
  ['findings.type-never-published', 'findings', { kind: 'type-never-published', verbose: false }],
];

/**
 * Findings that hold on a real project (P395): a screen fed through a stream
 * relaying two channels checked against both, one fed through a stream whose
 * relays are not all read held back, an answer field read behind a presence
 * check held back beside one read plainly, contract breaks at warning counted
 * and the one error listed, and a route answering a type made of itself.
 */
const HOLD_CASES = [
  ['findings.all', 'findings', {}],
  ['findings.type-never-published', 'findings', { kind: 'type-never-published' }],
  ['findings.contract-break', 'findings', { kind: 'contract-break' }],
  ['findings.contract-break-warnings', 'findings', { kind: 'contract-break', severity: 'warning' }],
  ['check_contract.answer-guarded', 'check_contract', { edge: 'GET /stores/:id' }],
  ['check_contract.answer-made-of-itself', 'check_contract', { edge: 'GET /categories/tree' }],
  // P397: each handler compared under the types the relay's if/else and its parameter say, one said two ways held back.
  ['findings.field-never-sent', 'findings', { kind: 'field-never-sent' }],
  ['check_contract.chosen-types', 'check_contract', { channel: 'build_updates' }],
];
/** The same, compact: what an agent is handed. */
const HOLD_COMPACT_CASES = [
  ['findings.all', 'findings', { verbose: false }],
  ['check_contract.answer-guarded', 'check_contract', { edge: 'GET /stores/:id', verbose: false }],
];
/**
 * Protocol, validation, settings, status and CORS mismatches (P388): each
 * defect gated on its evidence beside a decoy, with its precision and fix.
 */
const MISMATCH_CASES = [
  ['findings.all', 'findings', {}],
  ['findings.sse-event-unhandled', 'findings', { kind: 'sse-event-unhandled' }],
  ['findings.status-never-answered', 'findings', { kind: 'status-never-answered' }],
  ['findings.cors-credentials', 'findings', { kind: 'cors-credentials' }],
  ['findings.config-name-mismatch', 'findings', { kind: 'config-name-mismatch' }],
  ['findings.bot-button-unhandled', 'findings', { kind: 'bot-button-unhandled' }],
];
/** The same, compact: what an agent is handed. */
const MISMATCH_COMPACT_CASES = [
  ['findings.all', 'findings', { verbose: false }],
  ['findings.bot-button-data-too-long', 'findings', { kind: 'bot-button-data-too-long', verbose: false }],
  ['findings.cors-header-not-allowed', 'findings', { kind: 'cors-header-not-allowed', verbose: false }],
];

/**
 * Answers that finish in one call (P364): each row of code with whether it
 * runs and the nearest way in (a screen for a handler the router shows, none
 * for one no way in reaches), each list saying whether it is complete and what
 * was left if not, several inputs in one call, and `next` without a call a
 * row already answers.
 */
const SCREEN_REACH_CASES = [
  ['who_consumes.type-screens', 'who_consumes', { channel: 'desk:*:events', type: 'TICKET_ASSIGNED' }],
  ['who_consumes.type-unreached', 'who_consumes', { channel: 'desk:*:events', type: 'TICKET_REOPENED' }],
  ['who_emits.type-route', 'who_emits', { channel: 'desk:*:events', type: 'TICKET_ASSIGNED' }],
  ['who_calls.depth-drawn', 'who_calls', { symbol: 'desk-api#src/tickets/tickets.service.ts:TicketsService.assign', depth: 1 }],
  ['impact.reach', 'impact', { symbol: 'desk-api#src/tickets/tickets.service.ts:TicketsService.close' }],
  ['dead.several', 'dead', { ids: ['consumer:console#src/screens/QueueScreen.tsx:onQueueEvent', 'desk-api#src/tickets/tickets.service.ts:TicketsService.reopen'] }],
  ['find_symbol.several', 'find_symbol', { queries: ['onTicketEvent', 'reopen'] }],
  ['search.several', 'search', { queries: ['QueueScreen', 'TICKET_CLOSED'], kinds: ['classes', 'messages'] }],
  ['get_type.several', 'get_type', { types: ['DeskEvent', 'NoSuchType'] }],
  ['list_entries.page-left', 'list_entries', { maxNodes: 2 }],
];

/**
 * Loops that run a query per item (P89): searched busiest first, each saying
 * how sure it is, and written into the prompt with the ways in that reach it.
 */
const LOOPS_CASES = [
  ['search.query-in-loop', 'search', { query: 'query-in-loop', kinds: ['gaps'] }],
  ['describe_for_prompt.labels', 'describe_for_prompt', { id: 'GET /parcels/labels' }],
  // A finding asked for as a cause (P94): empty, and saying why.
  ['cant_follow.finding', 'cant_follow', { cause: 'query-in-loop' }],
  // The likely loops ranked by the ways in that reach them, the per-item ones counted (P95).
  ['findings.n-plus-one', 'findings', { kind: 'n-plus-one' }],
];

/** A deployment's settings against the code it runs (P389): every kind with its rows, and two kinds paged. */
const SETTINGS_CASES = [
  ['findings.all', 'findings', {}],
  ['findings.batch-failures-unreported', 'findings', { kind: 'batch-failures-unreported' }],
  ['findings.queue-visibility-short', 'findings', { kind: 'queue-visibility-short' }],
  ['cant_follow.setting-unread', 'cant_follow', { cause: 'deployment-setting-unread' }],
];
/** The same, compact: what an agent is handed. */
const SETTINGS_COMPACT_CASES = SETTINGS_CASES.map(([name, tool, args]) => [name, tool, { ...args, verbose: false }]);

/**
 * What the reader could not follow (P75), asked the ways that used to answer
 * nothing (P94): a method nothing calls, in a file with gaps that may hide its
 * caller, and a cause that does not exist.
 */
const CANT_FOLLOW_CASES = [
  ['who_calls.top-of-chain', 'who_calls', { symbol: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
  ['impact.no-entries', 'impact', { symbol: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
  ['cant_follow.unknown-cause', 'cant_follow', { cause: 'dynamic-membr' }],
  // The same method asked whether it is dead (P95): nothing calls it, and its class is not reached either.
  ['dead.top-of-chain', 'dead', { id: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
];

/**
 * The repository nobody added (P122): `start_here` names it, with the
 * directory the command line found for it, and a gap that is evidence for it
 * is written with how to close it - by name, by its gap id and by its place -
 * and cant_follow and search hand on to that prompt.
 */
const missingRepo = join(root, 'fixtures', 'missing-repo');
const MISSING_REPO_CASES = [
  ['start_here.all', 'start_here', {}],
  ['describe_for_prompt.gap', 'describe_for_prompt', { id: 'gap:gateway|src/checkout.controller.ts|unknown-base-url-env' }],
  ['describe_for_prompt.place', 'describe_for_prompt', { id: 'src/checkout.controller.ts:21' }],
  ['cant_follow.all', 'cant_follow', {}],
  ['search.payments', 'search', { query: 'PAYMENTS_URL', kinds: ['gaps'] }],
];

/**
 * The same project with the traffic `cli-snapshots` observed beside it (P144):
 * the blind spots of `payments`, a service nobody configured, are a check of
 * their own whose "How to close it" names the repository, and `start_here`
 * still names one group, with traffic among its evidence.
 */
const MISSING_REPO_TRAFFIC_CASES = [
  ['describe_for_prompt.blind', 'describe_for_prompt', { id: 'gap:payments||seen-not-in-code' }],
  ['start_here.all', 'start_here', {}],
];
const missingRepoTrafficCopy = () => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-missing-traffic-'));
  cpSync(join(missingRepo, '.flowatlas'), copy, { recursive: true });
  copyFileSync(join(missingRepo, 'expected.cli', 'observe.traffic.json'), join(copy, 'observed.json'));
  return copy;
};

/**
 * Plumbing every method shares (P92): a logger, a counter and a repository
 * helper under every caller. Each node is written once, the budget goes to the
 * crossings first, and both flows reach billing with the defaults; cut tight,
 * the answer says which limit stopped it and which crossings it left.
 */
const PLUMBING_CASES = [
  ['get_flow.post-orders', 'get_flow', { entry: 'POST /orders' }],
  ['get_flow.invoice', 'get_flow', { entry: 'POST /orders/:param/invoice' }],
  ['get_flow.node-cap', 'get_flow', { entry: 'POST /orders', maxNodes: 12 }],
  ['get_flow.char-cap', 'get_flow', { entry: 'POST /orders/:param/invoice', maxChars: 3000 }],
  ['describe_for_prompt.post-orders', 'describe_for_prompt', { id: 'POST /orders' }],
];

/**
 * A branch (P96): five edits to a project of three services - a required
 * field the gateway does not send, an import split over lines, a method
 * removed, a drift annotated, and a route renamed that the gateway still asks
 * for beside a method that now picks its receiver at run time. Asked for the
 * verdict, for one service, without the verdict, and the prompts and
 * resources that start such a review.
 */
const DIFF_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['what_changed.verdict', 'what_changed', { verdict: true }],
  ['what_changed.by-service', 'what_changed', { verdict: true, service: 'orders' }],
  ['what_changed.plain', 'what_changed', { service: 'billing' }],
  ['what_changed.no-such-service', 'what_changed', { verdict: true, service: 'shipping' }],
  ['prompts.list', '#listPrompts', {}],
  ['prompt.before-rename', '#getPrompt', { name: 'before-rename', arguments: { symbol: 'entry:orders:http:POST:/orders' } }],
  ['prompt.before-rename-ambiguous', '#getPrompt', { name: 'before-rename', arguments: { symbol: 'POST /orders' } }],
  ['prompt.pr-review', '#getPrompt', { name: 'pr-review', arguments: {} }],
  ['prompt.pr-review-other-base', '#getPrompt', { name: 'pr-review', arguments: { base: 'main' } }],
  ['prompt.trace-route', '#getPrompt', { name: 'trace-route', arguments: { route: 'entry:gateway:http:POST:/orders' } }],
  ['prompt.trace-route-stops', '#getPrompt', { name: 'trace-route', arguments: { route: 'GET /orders/:param/shipment' } }],
  ['resources.list', '#listResources', {}],
  ['resources.templates', '#listResourceTemplates', {}],
  ['resource.services', '#readResource', { uri: 'flowatlas://services' }],
  ['resource.service-orders', '#readResource', { uri: 'flowatlas://services/orders' }],
];

/**
 * A deploy (P117): the `drop-lookup` branch of orders checked against prod
 * (not deployable: a removed route the deployed gateway calls, a handler of
 * what nothing in prod publishes), and against canary, whose pin of orders
 * names a tag nobody made. `start_here` says each environment's verdict.
 */
const DEPLOYED_CASES = [
  ['what_changed.check-prod', 'what_changed', { file: 'check.prod.json', verdict: true }],
  ['what_changed.check-canary', 'what_changed', { file: 'check.canary.json' }],
  ['what_changed.not-a-document', 'what_changed', { file: 'graph.db' }],
  ['start_here.checks', 'start_here', {}],
];

/** The architecture rules of `fixtures/multi-repo-rules` (P114), as an assistant is handed them. */
const RULES_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['check_rules.all', 'check_rules', {}],
  ['check_rules.by-service', 'check_rules', { service: 'billing' }],
  ['check_rules.one-rule', 'check_rules', { rule: 'frontends-reach-only-edge' }],
  ['check_rules.typo', 'check_rules', { rule: 'only-orders-write-orders' }],
  ['get_flow.violates', 'get_flow', { entry: 'consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated' }],
  ['describe_for_prompt.service', 'describe_for_prompt', { id: 'billing', scope: 'service' }],
  ['start_here.rules', 'start_here', {}],
  ['findings.rule', 'findings', { kind: 'rule' }],
];

/**
 * A channel asked for as code writes it, of a server started on a database
 * alone (P360): `fixtures/folded-channels`, whose channels are named at run
 * time (`order:*:closed`). A placeholder and a value each answer for the one
 * channel they denote, saying which; a name that fits several lists them; and
 * with no configuration `get_source` is not listed, so an answer that would
 * send the agent to read a step says the file and line instead.
 */
const foldedChannels = join(root, 'fixtures', 'folded-channels');
const DATABASE_ALONE_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['who_consumes.placeholder', 'who_consumes', { channel: 'order:<orderId>:closed' }],
  ['who_emits.template', 'who_emits', { channel: 'channel:order:${order.id}:opened' }],
  ['who_consumes.value', 'who_consumes', { channel: 'order:42:on-hold' }],
  ['who_consumes.several', 'who_consumes', { channel: 'order:{id}:{state}' }],
  ['describe_for_prompt.placeholder', 'describe_for_prompt', { id: 'order:<orderId>:closed' }],
  ['dead.handler', 'dead', { id: 'consumer:worker#src/projections/lifecycle.service.ts:LifecycleProjections.onClosed' }],
];
const databaseAloneCopy = () => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-database-alone-'));
  cpSync(join(foldedChannels, '.flowatlas'), copy, { recursive: true });
  return copy;
};

/**
 * A change not yet committed (P387): `fixtures/edit-breaks-other-repos` built,
 * then its `edits/` laid over the working tree - the archive route renamed,
 * the stock message's `sku` sent under another key. `check_change` compares
 * the working tree with the built graph through the command line's own
 * checker, as `flowatlas mcp` hands it; the edit hook is asked about the same
 * edits made one at a time, about a whole file written, and about edits that
 * take out nothing another repository uses.
 */
const EDITED_CONTROLLER = 'catalog-api/src/items/items.controller.ts';
const EDITED_SERVICE = 'catalog-api/src/items/items.service.ts';
const EDITED_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['check_change.edited', 'check_change', {}],
  ['check_change.edited-compact', 'check_change', { verbose: false }],
  ['check_change.unknown-service', 'check_change', { services: ['payments'] }],
  ['edit-hook.route-renamed', '#editHook', { file: EDITED_CONTROLLER, old: "@Patch(':id/archive')", new: "@Patch(':id/retire')" }],
  ['edit-hook.field-renamed', '#editHook', { file: EDITED_SERVICE, old: "{ type: 'STOCK_LOW', sku, remaining }", new: "{ type: 'STOCK_LOW', itemCode: sku, remaining }" }],
  ['edit-hook.file-written', '#editHook', { file: EDITED_CONTROLLER, write: true }],
  ['edit-hook.other-get-line', '#editHook', { file: EDITED_CONTROLLER, old: "@Get()\n  list(): string[] {", new: "@Get('all')\n  list(): string[] {" }],
  ['edit-hook.nothing-crosses', '#editHook', { file: EDITED_SERVICE, old: 'return id;', new: 'return id.trim();' }],
];

/** The hook's answer for one edit of the edited project: the call Claude Code would send, the file as the edit left it. */
const editHookAsk = (args, made) => {
  const edited = made.edited.find((each) => each.file === args.file);
  const path = join(made.project, args.file);
  let now = readFileSync(path, 'utf8');
  if (args.old !== undefined && !now.includes(args.new) && now.includes(args.old)) now = now.replace(args.old, args.new);
  const call =
    args.write === true
      ? { tool_name: 'Write', tool_input: { file_path: path, content: now }, tool_response: { type: 'update', filePath: path, originalFile: edited?.before } }
      : { tool_name: 'Edit', tool_input: { file_path: path, old_string: args.old, new_string: args.new } };
  const index = JSON.parse(readFileSync(join(made.project, '.flowatlas', 'edits.json'), 'utf8'));
  return { context: editContextFor(call, index, now, 'linux') ?? null };
};

/**
 * What changes from run to run in a check's answer: how long it took, and the
 * commit the copy's checkout is on (it is this repository's, as the copy sits
 * inside it).
 */
const steadyCheck = (parsed) =>
  typeof parsed?.ms === 'number'
    ? { ...parsed, ms: 0, compared: String(parsed.compared).replace(/\b[0-9a-f]{8}\b/g, '<commit>') }
    : parsed;

/**
 * What a client asks besides a tool, by the name a case gives it, and the
 * document recorded: the listing as it comes, a resource's JSON read back.
 */
const CLIENT_ASKS = {
  '#listToolNames': async (client) => (await client.listTools()).tools.map((tool) => tool.name),
  '#listPrompts': (client) => client.listPrompts(),
  '#getPrompt': (client, args) => client.getPrompt(args),
  '#listResources': (client) => client.listResources(),
  '#listResourceTemplates': (client) => client.listResourceTemplates(),
  '#readResource': async (client, args) => JSON.parse((await client.readResource(args)).contents[0].text),
  // An answer handed on as plain text (P382): its text, and that no structured content came with it.
  '#callText': async (client, args) => {
    const response = await client.callTool(args);
    return { text: response.content[0].text, structuredContent: response.structuredContent !== undefined };
  },
  '#editHook': (_client, args, made) => editHookAsk(args, made),
};

/**
 * The Markdown of three answers above, written out as the prompt snapshots
 * (P97): the page's "Copy as prompt" test and the server's test both read
 * them, so one file is what both sides must write.
 */
const PROMPTS = {
  dir: join(fixture, 'expected.prompt'),
  files: { 'describe_for_prompt.invoice': 'entry.md', 'describe_for_prompt.channel': 'channel.md', 'describe_for_prompt.gap': 'row.md' },
};

/**
 * A draft rule checked before it is suggested (P121): what `test_pattern`
 * answers for a rule that reads the call, and for one that cannot be said.
 * The server is handed the command line's own tester, as `flowatlas mcp` is.
 */
const housePatterns = join(root, 'fixtures', 'house-patterns');
const PATTERN_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['test_pattern.draft', 'test_pattern', {
    yaml: '- id: shop-bus-emit\n  kind: publish\n  on: { receiverType: ShopBus }\n  pattern: "$BUS.emit({ topic: $CHANNEL, data: $PAYLOAD })"\n  channel: $CHANNEL\n  payload: $PAYLOAD\n',
    code: "bus.emit({ topic: 'book.added', data: book })",
  }],
  ['test_pattern.refused', 'test_pattern', {
    yaml: '- id: shop-bus-later\n  kind: publish\n  on: { receiverType: ShopBus }\n  pattern: "$BUS.later(() => $TOPIC)"\n  channel: $TOPIC\n',
  }],
];
const patternTester = (input) =>
  testPatternText(input, { config: loadConfig(join(housePatterns, 'flowatlas.config.json'), { checkRepos: false }).config });

/**
 * What real traffic did (P105), asked of the multi-repo graph with the
 * observed file `flowatlas observe` wrote over the fixture's traces: the
 * CLI's `observe.json` snapshot, put beside a copy of the fixture's database
 * so no other suite sees it. The busiest ways in, the slowest steps, a slow
 * and a failing request step by step, an entry with no sample, and the rows
 * of get_flow, who_calls and list_entries with timings beside `observed`;
 * then the statuses ways in answered that their code does not declare, and
 * the declared ones nobody answered, on their own and on get_flow and
 * describe_for_prompt (P106).
 */
const OBSERVED_CASES = [
  ['tools.listed', '#listToolNames', {}],
  ['hot_paths.all', 'hot_paths', {}],
  ['hot_paths.by-service', 'hot_paths', { service: 'billing', limit: 1, joins: 1 }],
  ['slow_steps.all', 'slow_steps', { minCount: 1 }],
  ['slow_steps.by-max', 'slow_steps', { by: 'max', minCount: 1, limit: 3 }],
  ['slow_steps.entry', 'slow_steps', { entry: 'entry:gateway:http:GET:/orders/:param', minCount: 1 }],
  ['slow_steps.too-few', 'slow_steps', { minCount: 50 }],
  ['trace_for.route', 'trace_for', { entry: 'POST /orders' }],
  ['trace_for.cross-service', 'trace_for', { entry: 'entry:gateway:http:GET:/orders/:param' }],
  ['trace_for.cut', 'trace_for', { entry: 'POST /invoices', maxNodes: 2 }],
  ['trace_for.no-sample', 'trace_for', { entry: 'entry:orders:http:POST:/orders/:param/archive' }],
  ['get_flow.observed', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' }],
  ['who_calls.observed', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6 }],
  ['list_entries.observed', 'list_entries', { service: 'billing' }],
  ['undeclared_failures.all', 'undeclared_failures', {}],
  ['undeclared_failures.bounded', 'undeclared_failures', { service: 'billing', limit: 1, minHits: 2 }],
  ['get_flow.failures', 'get_flow', { entry: 'POST /invoices' }],
  ['describe_for_prompt.failures', 'describe_for_prompt', { id: 'entry:billing:http:POST:/invoices' }],
  // What the code runs and traffic never touched, strong first (P110): every
  // row, one service's strong ones, a window cut at read time, and one the
  // file holds less of than asked; the blind spots under their own cause;
  // `dead` with traffic as evidence; and a best guess twenty page loads went
  // through, confirmed on the rows that show it.
  ['never_seen.all', 'never_seen', {}],
  ['never_seen.strong-gateway', 'never_seen', { service: 'gateway', confidence: 'strong', limit: 5 }],
  ['never_seen.since-1h', 'never_seen', { since: '1h', kind: 'http' }],
  ['never_seen.short', 'never_seen', { since: '7d', service: 'orders' }],
  ['cant_follow.seen-not-in-code', 'cant_follow', { cause: 'seen-not-in-code' }],
  ['dead.likely-by-traffic', 'dead', { id: 'entry:gateway:http:POST:/orders/:param/cancel' }],
  ['dead.seen', 'dead', { id: 'entry:billing:http:GET:/invoices/:param' }],
  ['dead.observed', 'dead', { service: 'gateway', kind: 'entries' }],
  ['who_calls.confirmed', 'who_calls', { symbol: 'entry:gateway:http:GET:/orders/:param', depth: 1 }],
];

/** A copy of the fixture's output with the observed file beside it, removed when the run ends. */
const observedCopy = () => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-observed-'));
  cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
  copyFileSync(join(fixture, 'expected.cli', 'observe.json'), join(copy, 'observed.json'));
  return copy;
};

/**
 * What traffic carried against what the code declares (P113), asked of the
 * multi-repo graph with the observed file `observe --shapes` wrote over the
 * traces and the front end's HAR (the CLI's `observe.shapes.json`): a route
 * whose request carries a field its DTO lacks and lacks one it requires, the
 * same route asked through the call into it, a route whose answers carry
 * fields the front end's type lacks, one that agrees, one with nothing
 * declared, and `get_flow` hinting `check_contract` where traffic differs.
 */
const SHAPES_CASES = [
  ['check_contract.traffic-request', 'check_contract', { edge: 'entry:gateway:http:POST:/orders/:param/invoice' }],
  [
    'check_contract.traffic-edge',
    'check_contract',
    { from: 'ui_api_call:web#src/app/orders-api.service.ts:21:12', to: 'entry:gateway:http:GET:/orders/:param' },
  ],
  ['check_contract.traffic-response', 'check_contract', { edge: 'entry:gateway:http:GET:/orders/:param' }],
  ['check_contract.traffic-agrees', 'check_contract', { edge: 'entry:orders:http:GET:/orders/:param' }],
  ['check_contract.traffic-billing', 'check_contract', { edge: 'entry:billing:http:POST:/invoices' }],
  ['check_contract.traffic-undeclared', 'check_contract', { edge: 'entry:gateway:http:POST:/orders/:param/refund' }],
  ['check_contract.traffic-none', 'check_contract', { edge: 'entry:orders:http:POST:/orders' }],
  ['get_flow.traffic-differs', 'get_flow', { entry: 'POST /orders/:id/invoice', maxNodes: 5 }],
  // A route bodies reached is seen though its call was counted on none (P148): POST /orders/:param/invoice is not listed.
  ['never_seen.shapes-gateway', 'never_seen', { service: 'gateway' }],
];

/** A copy of the fixture's output with the shapes file beside it. */
const shapesCopy = () => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-shapes-'));
  cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
  copyFileSync(join(fixture, 'expected.cli', 'observe.shapes.json'), join(copy, 'observed.json'));
  return copy;
};

/** The traffic checker the command hands its server, over the copy's database. */
const shapesOptions = (copy) => {
  const handle = new DbHandle({ dbPath: join(copy, 'graph.db'), configPath: join(fixture, 'flowatlas.config.json') });
  return {
    trafficChecker: trafficHook(() => {
      const opened = handle.open();
      return 'error' in opened ? undefined : opened.db;
    }),
  };
};

const SUITES = [
  { fixture, outDir, cases: CASES, prompts: PROMPTS },
  { fixture, outDir: join(fixture, 'expected.mcp.compact'), cases: COMPACT_CASES },
  {
    fixture: join(root, 'fixtures', 'sse-hub-subject-screens'),
    outDir: join(root, 'fixtures', 'sse-hub-subject-screens', 'expected.mcp.compact'),
    cases: HUB_SUBJECT_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'angular-basic'),
    outDir: join(root, 'fixtures', 'angular-basic', 'expected.mcp.compact'),
    cases: SCREEN_COMPACT_CASES,
  },
  { fixture: housePatterns, outDir: join(housePatterns, 'expected.mcp'), cases: PATTERN_CASES, options: { patternTester } },
  {
    fixture,
    outDir: join(fixture, 'expected.mcp.observed'),
    cases: OBSERVED_CASES,
    copy: observedCopy,
  },
  {
    fixture,
    outDir: join(fixture, 'expected.mcp.shapes'),
    cases: SHAPES_CASES,
    copy: shapesCopy,
    options: shapesOptions,
  },
  {
    fixture: join(root, 'fixtures', 'nest-check-through-helper'),
    outDir: join(root, 'fixtures', 'nest-check-through-helper', 'expected.mcp'),
    cases: HELPER_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'space-message-types'),
    outDir: join(root, 'fixtures', 'space-message-types', 'expected.mcp'),
    cases: MESSAGE_TYPE_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'sse-hub-subject-screens'),
    outDir: join(root, 'fixtures', 'sse-hub-subject-screens', 'expected.mcp'),
    cases: HUB_SUBJECT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'helpdesk-screen-reach'),
    outDir: join(root, 'fixtures', 'helpdesk-screen-reach', 'expected.mcp'),
    cases: SCREEN_REACH_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-calling-side'),
    outDir: join(root, 'fixtures', 'impact-calling-side', 'expected.mcp'),
    cases: CALLING_SIDE_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-calling-side'),
    outDir: join(root, 'fixtures', 'impact-calling-side', 'expected.mcp.compact'),
    cases: CALLING_SIDE_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-bot-webhook'),
    outDir: join(root, 'fixtures', 'impact-bot-webhook', 'expected.mcp'),
    cases: BOT_WEBHOOK_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-bot-webhook'),
    outDir: join(root, 'fixtures', 'impact-bot-webhook', 'expected.mcp.compact'),
    cases: BOT_WEBHOOK_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'angular-rendered-reach'),
    outDir: join(root, 'fixtures', 'angular-rendered-reach', 'expected.mcp'),
    cases: RENDERED_REACH_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'angular-rendered-reach'),
    outDir: join(root, 'fixtures', 'angular-rendered-reach', 'expected.mcp.compact'),
    cases: RENDERED_REACH_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-shared-client'),
    outDir: join(root, 'fixtures', 'impact-shared-client', 'expected.mcp'),
    cases: SHARED_CLIENT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-shared-client'),
    outDir: join(root, 'fixtures', 'impact-shared-client', 'expected.mcp.compact'),
    cases: SHARED_CLIENT_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'typed-handlers-bus-wide-subscribers'),
    outDir: join(root, 'fixtures', 'typed-handlers-bus-wide-subscribers', 'expected.mcp'),
    cases: TYPED_HANDLER_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'typed-handlers-bus-wide-subscribers'),
    outDir: join(root, 'fixtures', 'typed-handlers-bus-wide-subscribers', 'expected.mcp.compact'),
    cases: TYPED_HANDLER_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'fields-read-and-sent'),
    outDir: join(root, 'fixtures', 'fields-read-and-sent', 'expected.mcp'),
    cases: FIELDS_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'fields-read-and-sent'),
    outDir: join(root, 'fixtures', 'fields-read-and-sent', 'expected.mcp.compact'),
    cases: FIELDS_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'findings-between-services'),
    outDir: join(root, 'fixtures', 'findings-between-services', 'expected.mcp'),
    cases: BETWEEN_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'findings-between-services'),
    outDir: join(root, 'fixtures', 'findings-between-services', 'expected.mcp.compact'),
    cases: BETWEEN_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'findings-that-hold'),
    outDir: join(root, 'fixtures', 'findings-that-hold', 'expected.mcp'),
    cases: HOLD_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'findings-that-hold'),
    outDir: join(root, 'fixtures', 'findings-that-hold', 'expected.mcp.compact'),
    cases: HOLD_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'boundary-mismatches'),
    outDir: join(root, 'fixtures', 'boundary-mismatches', 'expected.mcp'),
    cases: MISMATCH_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'boundary-mismatches'),
    outDir: join(root, 'fixtures', 'boundary-mismatches', 'expected.mcp.compact'),
    cases: MISMATCH_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-guarded-navigation'),
    outDir: join(root, 'fixtures', 'impact-guarded-navigation', 'expected.mcp'),
    cases: GUARDED_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'impact-guarded-navigation'),
    outDir: join(root, 'fixtures', 'impact-guarded-navigation', 'expected.mcp.compact'),
    cases: GUARDED_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'rows-name-handling-code'),
    outDir: join(root, 'fixtures', 'rows-name-handling-code', 'expected.mcp'),
    cases: HANDLING_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'rows-name-handling-code'),
    outDir: join(root, 'fixtures', 'rows-name-handling-code', 'expected.mcp.compact'),
    cases: HANDLING_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'callers-walked-to-ways-in'),
    outDir: join(root, 'fixtures', 'callers-walked-to-ways-in', 'expected.mcp'),
    cases: CALLERS_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'callers-walked-to-ways-in'),
    outDir: join(root, 'fixtures', 'callers-walked-to-ways-in', 'expected.mcp.compact'),
    cases: CALLERS_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'request-lands-on-route'),
    outDir: join(root, 'fixtures', 'request-lands-on-route', 'expected.mcp'),
    cases: REQUEST_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'request-lands-on-route'),
    outDir: join(root, 'fixtures', 'request-lands-on-route', 'expected.mcp.compact'),
    cases: REQUEST_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'service-picks-the-symbol'),
    outDir: join(root, 'fixtures', 'service-picks-the-symbol', 'expected.mcp'),
    cases: PICKED_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'service-picks-the-symbol'),
    outDir: join(root, 'fixtures', 'service-picks-the-symbol', 'expected.mcp.compact'),
    cases: PICKED_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'one-call-per-question'),
    outDir: join(root, 'fixtures', 'one-call-per-question', 'expected.mcp'),
    cases: ONE_CALL_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'one-call-per-question'),
    outDir: join(root, 'fixtures', 'one-call-per-question', 'expected.mcp.compact'),
    cases: ONE_CALL_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'search-takes-a-sentence'),
    outDir: join(root, 'fixtures', 'search-takes-a-sentence', 'expected.mcp'),
    cases: SENTENCE_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'search-takes-a-sentence'),
    outDir: join(root, 'fixtures', 'search-takes-a-sentence', 'expected.mcp.compact'),
    cases: SENTENCE_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'route-order'),
    outDir: join(root, 'fixtures', 'route-order', 'expected.mcp'),
    cases: ROUTE_ORDER_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'route-order'),
    outDir: join(root, 'fixtures', 'route-order', 'expected.mcp.compact'),
    cases: ROUTE_ORDER_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'answer-fields-read'),
    outDir: join(root, 'fixtures', 'answer-fields-read', 'expected.mcp'),
    cases: ANSWER_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'answer-fields-read'),
    outDir: join(root, 'fixtures', 'answer-fields-read', 'expected.mcp.compact'),
    cases: ANSWER_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'loops-worth-fixing'),
    outDir: join(root, 'fixtures', 'loops-worth-fixing', 'expected.mcp'),
    cases: LOOPS_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'deployment-settings-terraform'),
    outDir: join(root, 'fixtures', 'deployment-settings-terraform', 'expected.mcp'),
    cases: SETTINGS_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'deployment-settings-terraform'),
    outDir: join(root, 'fixtures', 'deployment-settings-terraform', 'expected.mcp.compact'),
    cases: SETTINGS_COMPACT_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'cant-follow'),
    outDir: join(root, 'fixtures', 'cant-follow', 'expected.mcp'),
    cases: CANT_FOLLOW_CASES,
  },
  {
    fixture: missingRepo,
    outDir: join(missingRepo, 'expected.mcp'),
    cases: MISSING_REPO_CASES,
    options: missingCandidatesFor(join(missingRepo, 'flowatlas.config.json')),
  },
  {
    fixture: missingRepo,
    outDir: join(missingRepo, 'expected.mcp.traffic'),
    cases: MISSING_REPO_TRAFFIC_CASES,
    copy: missingRepoTrafficCopy,
    options: missingCandidatesFor(join(missingRepo, 'flowatlas.config.json')),
  },
  {
    fixture: join(root, 'fixtures', 'multi-repo-plumbing'),
    outDir: join(root, 'fixtures', 'multi-repo-plumbing', 'expected.mcp'),
    cases: PLUMBING_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'multi-repo-rules'),
    outDir: join(root, 'fixtures', 'multi-repo-rules', 'expected.mcp'),
    cases: RULES_CASES,
  },
  {
    outDir: join(root, 'fixtures', 'multi-repo-diff', 'expected.mcp'),
    cases: DIFF_CASES,
    // Made, built and diffed each run, and removed after: the fixture is two revisions as files.
    setup: () => diffFixtureProject(root),
    options: { reasonCatalog: reasonCatalog() },
  },
  {
    fixture: foldedChannels,
    outDir: join(foldedChannels, 'expected.mcp.database-alone'),
    cases: DATABASE_ALONE_CASES,
    copy: databaseAloneCopy,
    // `flowatlas mcp --db` with no configuration: no repository is known, so no code is served.
    noConfig: true,
  },
  {
    outDir: join(root, 'fixtures', 'multi-repo-deployed', 'expected.mcp'),
    cases: DEPLOYED_CASES,
    // Made, built and checked each run, and removed after: the fixture is three histories as files.
    setup: () => checkedDeployedProject(root),
  },
  {
    outDir: join(root, 'fixtures', 'edit-breaks-other-repos', 'expected.mcp'),
    cases: EDITED_CASES,
    // Made, built and edited each run, and removed after: the fixture is a project and the edits made to it.
    setup: () => editedFixtureProject(root),
    options: (_copy, made) => ({ changeChecker: changeCheckerFor(() => made.config) }),
    steady: steadyCheck,
  },
];

const problems = [];
let compared = 0;
let written = 0;

for (const suite of SUITES) {
  const made = suite.setup === undefined ? undefined : await suite.setup();
  const configPath = made?.config ?? join(suite.fixture, 'flowatlas.config.json');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const copy = suite.copy?.();
  const server = createFlowatlasServer({
    ...(suite.noConfig === true ? {} : { configPath }),
    // Nothing changes under a suite while it runs; the list is decided at each question.
    toolsPollMs: 0,
    ...(copy === undefined ? {} : { dbPath: join(copy, 'graph.db') }),
    ...(typeof suite.options === 'function' ? suite.options(copy, made) : (suite.options ?? {})),
  });
  await server.connect(serverSide);
  const client = new Client({ name: 'snapshots', version: '0' });
  await client.connect(clientSide);
  // Listing the tools first makes the client check every answer below against
  // its tool's outputSchema (P93), so a snapshot can only hold a declared shape.
  await client.listTools();

  if (update) {
    rmSync(suite.outDir, { recursive: true, force: true });
    mkdirSync(suite.outDir, { recursive: true });
    if (suite.prompts !== undefined) {
      rmSync(suite.prompts.dir, { recursive: true, force: true });
      mkdirSync(suite.prompts.dir, { recursive: true });
    }
  }

  for (const [name, tool, args] of suite.cases) {
    let parsed;
    if (tool.startsWith('#')) parsed = await CLIENT_ASKS[tool](client, args, made);
    else {
      // Asked `verbose` unless the case says otherwise (P365): these snapshots hold the whole answer, the compact ones what an agent is handed.
      const response = await client.callTool({ name: tool, arguments: { verbose: true, ...args } });
      parsed = JSON.parse(response.content[0].text);
      // The text and structuredContent are one document; an error carries isError instead.
      if (response.isError === true ? response.structuredContent !== undefined : !isDeepStrictEqual(response.structuredContent, parsed)) {
        problems.push(`${name}: structuredContent is not the document the text holds`);
      }
    }
    if (suite.steady !== undefined) parsed = suite.steady(parsed);
    const actual = `${JSON.stringify(parsed, null, 2)}\n`;
    const path = join(suite.outDir, `${name}.json`);
    const promptFile = suite.prompts?.files[name];
    if (promptFile !== undefined) {
      const promptPath = join(suite.prompts.dir, promptFile);
      if (update) writeFileSync(promptPath, parsed.markdown);
      else {
        let recorded;
        try {
          recorded = readFileSync(promptPath, 'utf8');
        } catch {
          recorded = undefined;
        }
        if (recorded !== parsed.markdown) problems.push(`${promptFile}: the prompt snapshot differs from ${name}'s markdown`);
      }
    }

    if (update) {
      writeFileSync(path, actual);
      written += 1;
      continue;
    }
    let expected;
    try {
      expected = readFileSync(path, 'utf8');
    } catch {
      problems.push(`${name}: no snapshot; run pnpm mcp:snapshots -- --update`);
      continue;
    }
    compared += 1;
    if (expected !== actual) problems.push(`${name}: answer differs from the snapshot`);
  }

  if (!update) {
    let recorded = [];
    try {
      recorded = readdirSync(suite.outDir).filter((file) => file.endsWith('.json'));
    } catch {
      recorded = [];
    }
    const extra = recorded.filter((file) => !suite.cases.some(([name]) => `${name}.json` === file));
    for (const file of extra) problems.push(`${file}: snapshot for a question nobody asks any more`);
  }

  await client.close();
  if (made !== undefined) rmSync(made.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (copy !== undefined) rmSync(copy, { recursive: true, force: true });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${written} mcp snapshot(s)` : `mcp snapshots ok: ${compared} compared`);
