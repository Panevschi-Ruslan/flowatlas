import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DbHandle, type DbHandleOptions } from './query/db.js';
import { registerChannels } from './tools/channels.js';
import type { ContractChecker, ToolContext } from './tools/common.js';
import { registerContract } from './tools/contract.js';
import { registerEntries } from './tools/entries.js';
import { registerFlow } from './tools/flow.js';
import { registerReach } from './tools/reach.js';
import { registerSource } from './tools/source.js';
import { registerTypes } from './tools/types.js';

export const SERVER_NAME = 'flowatlas';

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
      instructions:
        'A map of every repository in this project, already joined. Ask it what reaches what instead of reading files: list_entries to find a way in, get_flow to follow one through every service it touches, who_calls and impact to work backwards, who_emits and who_consumes for message channels, get_type for a shape, check_contract for whether two services still agree, find_symbol when you only half remember a name. Every answer is bounded; get_source is the only one that returns code.',
    },
  );

  registerEntries(server, context);
  registerFlow(server, context);
  registerReach(server, context);
  registerChannels(server, context);
  registerTypes(server, context);
  registerContract(server, context);
  registerSource(server, context);

  return server;
};

/** Runs the server over stdin and stdout, which is how an editor talks to it. */
export const startStdioServer = async (options: ServerOptions = {}): Promise<McpServer> => {
  const server = createFlowatlasServer(options);
  await server.connect(new StdioServerTransport());
  return server;
};
