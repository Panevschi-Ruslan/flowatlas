import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DbHandle, type DbHandleOptions } from './query/db.js';
import { registerChannels } from './tools/channels.js';
import type { ContractChecker, ToolContext } from './tools/common.js';
import { registerContract } from './tools/contract.js';
import { registerEntries } from './tools/entries.js';
import { registerFlow } from './tools/flow.js';
import { registerPrompt } from './tools/prompt.js';
import { registerReach } from './tools/reach.js';
import { registerSource } from './tools/source.js';
import { registerStart } from './tools/start.js';
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
  '- shape: get_type({type: id}); check_contract for whether two services still agree.',
  'describe_for_prompt({id}) writes any of these as Markdown to hand on. Every list tool takes the same optional `service` filter.',
  'Every answer is bounded; get_source is the only one that returns code.',
].join('\n');

export interface ServerOptions extends DbHandleOptions {
  /** Field-level contract rules, when the contracts package is installed. */
  contractChecker?: ContractChecker;
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

  return server;
};

/** Runs the server over stdin and stdout, which is how an editor talks to it. */
export const startStdioServer = async (options: ServerOptions = {}): Promise<McpServer> => {
  const server = createFlowatlasServer(options);
  await server.connect(new StdioServerTransport());
  return server;
};
