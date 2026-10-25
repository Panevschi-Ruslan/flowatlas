import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPrompts } from './prompts.js';
import { DbHandle, type DbHandleOptions } from './query/db.js';
import { registerResources, type ReasonHint } from './resources.js';
import { registerCantFollow } from './tools/cant-follow.js';
import { registerChanges } from './tools/changes.js';
import { registerChannels } from './tools/channels.js';
import type { ContractChecker, MissingCandidates, PatternTester, ToolContext, TrafficChecker } from './tools/common.js';
import { registerContract } from './tools/contract.js';
import { registerDead } from './tools/dead.js';
import { registerEntries } from './tools/entries.js';
import { registerFindings } from './tools/findings.js';
import { registerFlow } from './tools/flow.js';
import { registerPatterns } from './tools/patterns.js';
import { registerPrompt } from './tools/prompt.js';
import { registerReach } from './tools/reach.js';
import { registerRuntime } from './tools/runtime.js';
import { registerRules } from './tools/rules.js';
import { registerSearch } from './tools/search.js';
import { registerSource } from './tools/source.js';
import { registerSpec } from './tools/spec.js';
import { registerStart } from './tools/start.js';
import { registerTypeUsage } from './tools/type-usage.js';
import { registerTypes } from './tools/types.js';
import { listingSettingsOf, ToolListing } from './tool-listing.js';

export const SERVER_NAME = 'flowatlas';

/**
 * What a session is told before its first question.
 *
 * The chains are spelled out because they are the point: every row carries an
 * `id` the next tool takes as it is, and every answer ends with `next`, the
 * calls that take the ids it just returned.
 */
export const INSTRUCTIONS = [
  'A map of every repository in this project, already joined. Ask it what reaches what instead of reading files.',
  'Begin with start_here: counts per service, the most common gaps, and entry ids to start from.',
  'Every row carries an `id` that the next tool accepts as it is, and every answer ends with `next`, the calls that take those ids. The chains:',
  '- entry: list_entries -> get_flow({entry: id}) -> get_source({symbol: id}) on the step that matters.',
  '- channel: who_emits / who_consumes({channel: id}) -> get_flow({entry: id}) on a handler.',
  '- symbol: find_symbol -> who_calls / impact({symbol: id}) -> get_flow on an entry it names.',
  '- shape: get_type({type: id}) -> type_usage({type: id}): every way in, crossing, channel and call that takes or returns it, and the types holding it; check_contract for whether two services still agree; get_spec({service}) writes the routes of a service as OpenAPI 3.1 or its channels as AsyncAPI 3.0 (`kind`), and `path` ("GET /orders/{id}", a channel address) answers one operation with the schemas it uses.',
  '- search({query}) finds a route, channel, table, type, class or gap by name; what_changed reads the last flowatlas diff.',
  "- why a flow stops: cant_follow groups every step the reading could not follow by cause and package -> get_source on a place it names; a wrapper of the project's own -> test_pattern on a draft rule for it.",
  '- findings - a likely N+1, a route with no guard, a contract break, a channel with one end, a broken architecture rule (check_rules lists those) - are not gaps: findings() counts each kind with its top rows, ranked by reach; findings({kind}) lists one, each row with the call that shows it.',
  "- dead({id}) says whether a node is dead: `dead`, `likely-dead` (a call read in part could reach it: `couldHit`), `unknown` (`outside` the project, or a call `oneOff` a segment) or `alive`; dead({service}) lists them, verdict first.",
  '- run time: hot_paths -> slow_steps({entry: id}) -> trace_for({entry: id}), one slow and one failing request as trees of node ids -> get_source on a slow step.',
  '- failures at run time: undeclared_failures lists ways in that answered a status no failure in their code declares, 5xx first -> trace_for({entry}) for a failing request; get_flow `failures` and `fails[].seen` set the statuses seen beside the declared ones.',
  '- never seen: never_seen({since}) lists what the code runs and traffic never touched, `strong` beside a busy neighbour, `weak` otherwise -> dead({id}), which reads traffic as evidence (`seen`, `neverSeen`); cant_follow({cause: "seen-not-in-code"}) lists what traffic reached and no reader drew, with the call that looks for each; a best guess traffic went through says `confirmedBy: "traffic"`.',
  'get_flow, describe_for_prompt and impact carry `docs` when a Markdown page describes the node (flowatlas docs): `file`, `line` and `state`; `changed` or `gone` is a page to update with the change. start_here says `staleDocs`.',
  'Rows real traffic went through carry `observed: n`, with `p95` (ms) and `errorRate` where timed (`seenAmbiguous: n` where requests fit it and other places too, so were counted on none); gaps someone accepted with flowatlas accept carry `accepted: true`.',
  'describe_for_prompt({id}) writes any of these as Markdown to hand on; `scope` class, file or service writes the whole of one. Every list tool takes the same optional `service` filter, a service name, to keep only its rows.',
  'Every answer is bounded; get_source is the only one that returns code, and says `truncated` with the `fromLine` to read on from when a declaration is longer than one answer.',
  '`maxNodes` is the most rows an answer holds. A list that was cut says `total` and `nextOffset`: ask the same call again with `offset: nextOffset` for the next page, and `next` writes that call first.',
  'get_flow writes each node once: met again it is `{id, ref: true, seenAt}`, seenAt the row its subtree is under. It stops at `maxNodes` (60) or about `maxChars` (12000) characters, says which in `stoppedBy`, and lists the crossings it did not follow in `crossingsLeft`: ask get_flow on one.',
  'who_calls says `stoppedBy` and the `frontier` ids when depth cut it, and `topOfChain` with `gapsInFile` on a node nothing calls: dead, or called from behind a gap (dead({id}) says which it is likely to be). On a class it answers for its methods. A route said aloud (`GET /orders/123`) resolves to the most specific route, naming the others under `alsoAnswers`. A failed call is `isError` and names the nearest under `suggestions`.',
  'Prompts before-rename, pr-review and trace-route write out the calls those reviews take, ids resolved; resources flowatlas://reasons (why a step was not followed) and flowatlas://services/{name} read without asking. what_changed({verdict: true}) says safe, unsafe or unknown, and why.',
  'Only the tools this project can answer are listed: the run-time ones after flowatlas observe, check_rules with rules configured, what_changed after flowatlas diff, the channel and type tools once the graph holds one. start_here says what is not listed in `hidden`; the list changes as the project does.',
  '`detail` is 0 for ids only, 1 (the default) adds file:line, service and kind, 2 adds what the reader knows about each row; 3 is answered at 2.',
].join('\n');

export interface ServerOptions extends DbHandleOptions {
  /** Field-level contract rules, when the contracts package is installed. */
  contractChecker?: ContractChecker;
  /**
   * What `doctor` says about each reason, from the CLI, which this package
   * does not depend on (P96 D4): `flowatlas://reasons` reads it, and falls
   * back on core's cause sentences without it.
   */
  reasonCatalog?: readonly ReasonHint[];
  /** The pattern tester, when the readers are there to run it (P121). */
  patternTester?: PatternTester;
  /** The directories that look like each repository probably missing, when the command line can look (P122). */
  missingCandidates?: MissingCandidates;
  /** A route's traffic shapes against its code, when the contracts package is installed (P113). */
  trafficChecker?: TrafficChecker;
  version?: string;
  /**
   * List every tool, whatever the project can answer and whatever the
   * configuration's `mcp` block says (`flowatlas mcp --all-tools`, P201).
   */
  allTools?: boolean;
  /** How often, in ms, a connected server looks for a graph, observed file or diff that changed; 0 never. */
  toolsPollMs?: number;
}

/**
 * The server, with every tool registered and those the project can answer
 * listed (P201).
 *
 * Nothing is read here: the database is opened on the first question and
 * reopened if a build replaced it, so a server can start before a graph exists
 * and start answering as soon as one does. Before one exists only the tools
 * that need nothing but a graph are listed - each says to build one - and
 * `test_pattern`, which needs no graph. A configuration whose `mcp` block
 * names a tool there is none of is refused here, naming it.
 */
export const createFlowatlasServer = (options: ServerOptions = {}): McpServer => {
  const handle = new DbHandle(options);
  const settings = listingSettingsOf(handle.config?.mcp, {
    ...(options.allTools === undefined ? {} : { allTools: options.allTools }),
    ...(handle.configPath === undefined ? {} : { configPath: handle.configPath }),
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: options.version ?? '0.0.0' },
    {
      instructions: INSTRUCTIONS,
      // The list follows the project, so a client is told when it changes.
      capabilities: { tools: { listChanged: true } },
    },
  );
  const listing = new ToolListing(server, {
    handle,
    settings,
    tester: options.patternTester !== undefined,
    ...(options.toolsPollMs === undefined ? {} : { pollMs: options.toolsPollMs }),
  });
  const context: ToolContext = {
    handle,
    listing,
    ...(options.contractChecker === undefined ? {} : { contractChecker: options.contractChecker }),
    ...(options.patternTester === undefined ? {} : { patternTester: options.patternTester }),
    ...(options.missingCandidates === undefined ? {} : { missingCandidates: options.missingCandidates }),
    ...(options.trafficChecker === undefined ? {} : { trafficChecker: options.trafficChecker }),
  };

  listing.capture(() => registerTools(server, context));
  registerPrompts(server, context);
  registerResources(server, context, options.reasonCatalog);

  // A closed connection lets go of the database (P199). On Windows a file held
  // open can be neither removed nor replaced, so a server that kept it after
  // its client left would block the next build's rename and every clean-up of
  // the directory. The next question on a new connection opens it again; the
  // listing stops looking for changes until then.
  const closed = server.server.onclose;
  server.server.onclose = () => {
    listing.stop();
    handle.close();
    closed?.();
  };

  return server;
};

/** Every tool, each with its row in `TOOL_NEEDS` (`tool-needs.ts`). */
const registerTools = (server: McpServer, context: ToolContext): void => {
  registerStart(server, context);
  registerEntries(server, context);
  registerFlow(server, context);
  registerReach(server, context);
  registerChannels(server, context);
  registerTypes(server, context);
  registerContract(server, context);
  registerSource(server, context);
  registerPrompt(server, context);
  registerSearch(server, context);
  registerChanges(server, context);
  registerCantFollow(server, context);
  registerDead(server, context);
  registerFindings(server, context);
  registerTypeUsage(server, context);
  registerRules(server, context);
  registerSpec(server, context);
  registerPatterns(server, context);
  registerRuntime(server, context);
};

/** Runs the server over stdin and stdout, which is how an editor talks to it. */
export const startStdioServer = async (options: ServerOptions = {}): Promise<McpServer> => {
  const server = createFlowatlasServer(options);
  await server.connect(new StdioServerTransport());
  return server;
};
