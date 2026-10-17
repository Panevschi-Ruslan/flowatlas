import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPrompts } from './prompts.js';
import { DbHandle, type DbHandleOptions } from './query/db.js';
import { registerResources, type ReasonHint } from './resources.js';
import { registerCantFollow } from './tools/cant-follow.js';
import { registerChanges } from './tools/changes.js';
import { registerChannels } from './tools/channels.js';
import type { ContractChecker, ToolContext } from './tools/common.js';
import { registerContract } from './tools/contract.js';
import { registerDead } from './tools/dead.js';
import { registerEntries } from './tools/entries.js';
import { registerFindings } from './tools/findings.js';
import { registerFlow } from './tools/flow.js';
import { registerPrompt } from './tools/prompt.js';
import { registerReach } from './tools/reach.js';
import { registerSearch } from './tools/search.js';
import { registerSource } from './tools/source.js';
import { registerStart } from './tools/start.js';
import { registerTypeUsage } from './tools/type-usage.js';
import { registerTypes } from './tools/types.js';

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
  '- shape: get_type({type: id}) -> type_usage({type: id}): every way in, crossing, channel and call that takes or returns it, and the types holding it; check_contract for whether two services still agree.',
  '- search({query}) finds a route, channel, table, type, class or gap by name; what_changed reads the last flowatlas diff.',
  "- why a flow stops: cant_follow groups every step the reading could not follow by cause and package -> get_source on a place it names.",
  '- findings - a likely N+1, a route with no guard, a contract break, a channel with one end - are not gaps: findings() counts each kind with its top rows, ranked by reach; findings({kind}) lists one, each row with the call that shows it.',
  "- dead({id}) says whether a node is dead: `dead`, `likely-dead` (a call read in part could reach it: `couldHit`), `unknown` (`outside` the project, or a call `oneOff` a segment) or `alive`; dead({service}) lists them, verdict first.",
  'Rows real traffic went through carry `observed: n` (`seenAmbiguous: n` where requests fit it and other places too, so were counted on none); gaps someone accepted with flowatlas accept carry `accepted: true`.',
  'describe_for_prompt({id}) writes any of these as Markdown to hand on; `scope` class, file or service writes the whole of one. Every list tool takes the same optional `service` filter, a service name, to keep only its rows.',
  'Every answer is bounded; get_source is the only one that returns code, and says `truncated` with the `fromLine` to read on from when a declaration is longer than one answer.',
  '`maxNodes` is the most rows an answer holds. A list that was cut says `total` and `nextOffset`: ask the same call again with `offset: nextOffset` for the next page, and `next` writes that call first.',
  'get_flow writes each node once: met again it is `{id, ref: true, seenAt}`, seenAt the row its subtree is under. It stops at `maxNodes` (60) or about `maxChars` (12000) characters, says which in `stoppedBy`, and lists the crossings it did not follow in `crossingsLeft`: ask get_flow on one.',
  'who_calls says `stoppedBy` and the `frontier` ids when depth cut it, and `topOfChain` with `gapsInFile` on a node nothing calls: dead, or called from behind a gap (dead({id}) says which it is likely to be). On a class it answers for its methods. A route said aloud (`GET /orders/123`) resolves to the most specific route, naming the others under `alsoAnswers`. A failed call is `isError` and names the nearest under `suggestions`.',
  'Prompts before-rename, pr-review and trace-route write out the calls those reviews take, ids resolved; resources flowatlas://reasons (why a step was not followed) and flowatlas://services/{name} read without asking. what_changed({verdict: true}) says safe, unsafe or unknown, and why.',
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
  version?: string;
}

/**
 * The server, with every tool registered.
 *
 * Nothing is read here: the database is opened on the first question and
 * reopened if a build replaced it, so a server can start before a graph exists
 * and start answering as soon as one does.
 */
export const createFlowatlasServer = (options: ServerOptions = {}): McpServer => {
  const handle = new DbHandle(options);
  const context: ToolContext = {
    handle,
    ...(options.contractChecker === undefined ? {} : { contractChecker: options.contractChecker }),
  };

  const server = new McpServer(
    { name: SERVER_NAME, version: options.version ?? '0.0.0' },
    {
      instructions: INSTRUCTIONS,
    },
  );

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
  registerPrompts(server, context);
  registerResources(server, context, options.reasonCatalog);

  return server;
};

/** Runs the server over stdin and stdout, which is how an editor talks to it. */
export const startStdioServer = async (options: ServerOptions = {}): Promise<McpServer> => {
  const server = createFlowatlasServer(options);
  await server.connect(new StdioServerTransport());
  return server;
};
