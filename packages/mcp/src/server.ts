import { agentQuestionsLine } from '@flowatlas/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPrompts } from './prompts.js';
import { DbHandle, type DbHandleOptions } from './query/db.js';
import { registerResources, type OverviewWriter, type ReasonHint } from './resources.js';
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
import { listingSettingsOf, neverListed, noCodeSaid, rulesConfigured, ToolListing } from './tool-listing.js';
import { offeredText } from './offered.js';
import type { ToolName } from './tool-needs.js';

export const SERVER_NAME = 'flowatlas';

/**
 * What a session is told before its first question, and again on every turn
 * after it (P366): a client re-sends the instructions with every request,
 * while a tool's description and input reach the model only once the tool is
 * loaded. So this says what no single tool can - which tool to begin with,
 * how their ids chain, which tools are listed when, and the inputs every tool
 * shares - and what one tool's answer needs is said on that tool. At most
 * `INSTRUCTIONS_MAX` characters, with room for a line or two more.
 *
 * The core tools load upfront too (P380), so their descriptions are re-sent
 * on every turn beside these lines: what one of them says (a channel's `type`
 * and `field`, what `search` finds) is said there, not again here.
 *
 * The chains are spelled out because they are the point: every row carries an
 * `id` the next tool takes as it is, and every answer ends with `next`, the
 * calls that take the ids it just returned.
 */
const INSTRUCTION_LINES: readonly string[] = [
  'A map of every repository in this project, already joined.',
  // The same questions the files `flowatlas agents install` writes list (P227).
  agentQuestionsLine(),
  'Ask the tool your question needs; start_here when you do not know where to begin (counts per service, the commonest gaps, entry ids).',
  'Every row carries an `id` the next tool takes as it is; every answer ends with `next`, the calls that take those ids. The chains:',
  '- entry: list_entries -> get_flow({entry: id}) -> get_source({symbol: id}) on the step that matters.',
  '- channel: who_emits or who_consumes({channel: id}) -> get_flow({entry: id}) on a handler.',
  '- symbol: find_symbol -> who_calls or impact({symbol: id}) -> get_flow on an entry it names.',
  '- shape: get_type({type: id}) -> type_usage; check_contract on a crossing, a route or a channel; get_spec({service}).',
  '- name: search({query}), any kind of node.',
  '- stops: cant_follow -> get_source on a place it names; test_pattern on a draft rule.',
  '- dead code: findings() -> findings({kind}); dead({id}) or dead({service}).',
  '- run time: hot_paths -> slow_steps({entry: id}) -> trace_for({entry: id}); undeclared_failures; never_seen -> dead({id}).',
  '- to hand on: describe_for_prompt({id}), as Markdown.',
  "Shared inputs: `detail` 0 is ids only, 1 (the default) adds file:line, service and kind, 2 a list row's plain facts, one node's all; `service` keeps one service; `maxNodes` caps rows (150 unless said); a cut list says `nextOffset`: ask again with `offset: nextOffset`.",
  'Only the tools this project can answer are listed: run-time ones after flowatlas observe, check_rules with rules, what_changed after flowatlas diff, channel and type tools once the graph holds one; start_here names the rest in `hidden`. In Claude Code a tool not loaded yet loads by ToolSearch: every one you need in one call.',
  'Answers are compact: a row leaves out what its `id` says; `verbose: true` gives every field.',
  'Rows of code carry `reach` (alive; maybe: behind an unread call, see `gap`, `behind`; unreached; dead; outside: called from outside the project) and `from`, the nearest way in: no need to check them; keep maybe rows when asked what breaks. `complete: true` is the whole answer, else `left` says what was cut. Several at once: `ids`, `queries`, `symbols`, `types`.',
];

/** The most characters the instructions may run to (P366): they are re-sent on every turn of a session. */
export const INSTRUCTIONS_MAX = 2500;

/** The line that says when each tool appears: naming one there is the point, so it is said whatever is listed. */
const LISTING_LINE = INSTRUCTION_LINES.find((line) => line.startsWith('Only the tools this project can answer')) as string;

/** Said instead of the chains' last step when the server serves no code (P360). */
const NO_CODE_LINE = 'This server serves no code: to read a step, open the file and line its row gives at `detail` 1 (`loc`, or the file in its `id` and `line`), in its repository.';

export const INSTRUCTIONS = INSTRUCTION_LINES.join('\n');

/**
 * The instructions for a server that can never list `never` (P360): each
 * chain without the step a session could not take, so the first thing it
 * reads names no tool it will not find, and where code is to be read when
 * no code is served.
 */
export const instructionsFor = (never: ReadonlySet<ToolName>, noCode: string): string => {
  if (never.size === 0) return INSTRUCTIONS;
  const offer = { hidden: never, noCode };
  const lines = INSTRUCTION_LINES.map((line) => (line === LISTING_LINE ? line : offeredText(line, offer))).filter((line) => line !== '');
  return [...lines, ...(never.has('get_source') ? [NO_CODE_LINE] : [])].join('\n');
};

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
  /** Draws the project's overview for `flowatlas://overview`, from the command line, which owns it (P228). */
  overview?: OverviewWriter;
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
  /**
   * `false` lists no tool to load upfront (`flowatlas mcp --no-always-load`,
   * P380); otherwise the core tools are, unless the configuration's
   * `mcp.alwaysLoad` is `false`.
   */
  alwaysLoad?: boolean;
  /** How often, in ms, a connected server looks for a graph, observed file or diff that changed; 0 never. */
  toolsPollMs?: number;
  /**
   * Starts a background build, from the command line, which this package
   * cannot run (P230): called when an answer finds its files changed and the
   * configuration says `mcp.rebuild: on-change`, at most once every
   * `REBUILD_EVERY_MS`.
   */
  rebuild?: () => void;
}

/** The shortest time between two background builds the server starts: `build --background` coalesces the rest. */
export const REBUILD_EVERY_MS = 10_000;

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
  const rebuild = options.rebuild;
  if (rebuild !== undefined && handle.config?.mcp?.rebuild === 'on-change') {
    let last = 0;
    handle.onStale = () => {
      const now = Date.now();
      if (now - last >= REBUILD_EVERY_MS) {
        last = now;
        rebuild();
      }
      return true;
    };
  }
  const settings = listingSettingsOf(handle.config?.mcp, {
    ...(options.allTools === undefined ? {} : { allTools: options.allTools }),
    ...(options.alwaysLoad === undefined ? {} : { alwaysLoad: options.alwaysLoad }),
    ...(handle.configPath === undefined ? {} : { configPath: handle.configPath }),
  });

  const never = neverListed(settings, {
    sources: handle.config !== undefined,
    rules: rulesConfigured(handle.config),
    tester: options.patternTester !== undefined,
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: options.version ?? '0.0.0' },
    {
      instructions: instructionsFor(never, noCodeSaid(settings)),
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
  registerResources(server, context, options.reasonCatalog, options.overview);

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
