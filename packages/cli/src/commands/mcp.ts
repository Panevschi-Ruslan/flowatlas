import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContractChecker, type ContractFinding } from '@flowatlas/contracts';
import { loadConfig } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { Command } from 'commander';
import { ownBin } from '../own-path.js';

export const MCP_FILE = '.mcp.json';

/** The name the server is registered under, in every repository it is added to. */
export const SERVER_KEY = 'flowatlas';

interface ServerEntry {
  command: string;
  args: string[];
}

/** Whatever else a repository already asked for; never disturbed. */
interface McpFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

const binPath = (): string =>
  ownBin(import.meta.url);

/** True when `flowatlas` is on the path, so the entry can just say `flowatlas`. */
export const isOnPath = (probe: () => void = () => execFileSync('flowatlas', ['--version'])): boolean => {
  try {
    probe();
    return true;
  } catch {
    return false;
  }
};

/**
 * How a repository should start the server.
 *
 * An installed command is written as the bare name, which survives this
 * checkout moving. Without one, the absolute path to the binary is the only
 * thing that works, and writing it by hand is what this command exists to
 * avoid.
 */
export const serverEntry = (configPath: string, onPath: boolean): ServerEntry =>
  onPath
    ? { command: SERVER_KEY, args: ['mcp', '--config', configPath] }
    : { command: process.execPath, args: [binPath(), 'mcp', '--config', configPath] };

/**
 * Puts the server into a repository's configuration.
 *
 * Merged rather than written over: a repository may already have servers of its
 * own, and losing them to a convenience command would be worse than having to
 * paste one in by hand.
 */
export const withServer = (existing: string | undefined, entry: ServerEntry): string => {
  let file: McpFile = {};
  if (existing !== undefined && existing.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed === 'object' && parsed !== null) file = parsed as McpFile;
    } catch {
      throw new Error(`${MCP_FILE} is not valid JSON; fix or remove it and run this again`);
    }
  }
  file.mcpServers = { ...file.mcpServers, [SERVER_KEY]: entry };
  return `${JSON.stringify(file, null, 2)}\n`;
};

export interface InstallOptions {
  config?: string;
  /** Only this service. Every configured one by default. */
  repo?: string;
  /** Say what would be written and write nothing. */
  dryRun?: boolean;
  print?: (message: string) => void;
}

export interface Installed {
  service: string;
  path: string;
  /** False when the file already said exactly this. */
  changed: boolean;
}

/**
 * Registers the server in every repository of the project.
 *
 * The point is that a session in any one of them can ask about all of them, so
 * the useful unit is all of them at once, and the path each entry needs is
 * something the configuration already knows.
 */
export const installMcp = (options: InstallOptions = {}): Installed[] => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const loaded = loadConfig(options.config ?? process.cwd());
  const entry = serverEntry(loaded.configPath, isOnPath());

  const services =
    options.repo === undefined
      ? loaded.config.services
      : loaded.config.services.filter((service) => service.name === options.repo);
  if (services.length === 0) {
    throw new Error(`no service named ${JSON.stringify(String(options.repo))} in ${loaded.configPath}`);
  }

  const done: Installed[] = [];
  for (const service of services) {
    const path = join(loaded.repoDir(service), MCP_FILE);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    const next = withServer(existing, entry);
    const changed = next !== existing;
    if (changed && options.dryRun !== true) writeFileSync(path, next, 'utf8');
    done.push({ service: service.name, path, changed });
  }

  const verb = options.dryRun === true ? 'would write' : 'wrote';
  for (const item of done) {
    print(`  ${item.changed ? verb : 'unchanged'}  ${item.path}`);
  }
  print(
    entry.command === SERVER_KEY
      ? 'Each one starts the server with `flowatlas mcp`.'
      : 'Each one starts the server from this checkout, so it works with nothing installed. ' +
          'Install the command so `flowatlas` is on the path and run this again to write that instead.',
  );
  return done;
};

/**
 * Field-level answers for `check_contract`, over whichever graph is open.
 *
 * The server can say on its own whether two hashes agree; which field disagrees
 * needs the contract checker, and the server does not depend on it. Handing it
 * in here is what makes `flowatlas mcp` the wired path (D6). The report is
 * computed once per database and thrown away when a rebuild replaces the file,
 * so an agent asking about a second edge waits for nothing.
 */
export const contractsHook = (
  open: () => GraphDb | undefined,
): ((input: Parameters<ReturnType<typeof createContractChecker>>[0]) => ContractFinding[]) => {
  let cached: { db: GraphDb; ask: ReturnType<typeof createContractChecker> } | undefined;
  return (input) => {
    const db = open();
    if (db === undefined) return [];
    if (cached === undefined || cached.db !== db) cached = { db, ask: createContractChecker(db) };
    return cached.ask(input);
  };
};

/**
 * Serves the graph to an editor over stdin and stdout, or registers itself.
 *
 * Registration only for the serving half: the server lives in its own package
 * and is loaded when the command runs, so nothing about it is paid for by the
 * other commands.
 */
export const registerMcp = (program: Command): void => {
  program
    .command('mcp')
    .description('serve the project graph to an agent over stdio')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--install', `write ${MCP_FILE} into every repository of the project`)
    .option('--repo <name>', 'with --install, only this service')
    .option('--dry-run', 'with --install, say what would change and write nothing')
    .action(
      async (options: {
        config?: string;
        db?: string;
        install?: boolean;
        repo?: string;
        dryRun?: boolean;
      }) => {
        if (options.install === true) {
          installMcp({
            ...(options.config === undefined ? {} : { config: options.config }),
            ...(options.repo === undefined ? {} : { repo: options.repo }),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          });
          return;
        }

        const { DbHandle, startStdioServer } = await import('@flowatlas/mcp');
        const where = {
          ...(options.config === undefined ? {} : { configPath: options.config }),
          ...(options.db === undefined ? {} : { dbPath: options.db }),
          ...(options.config === undefined && options.db === undefined
            ? { configPath: process.cwd() }
            : {}),
        };
        // A handle of its own, so the checker reads the same file the tools do
        // and reopens with it, without reaching into the server's.
        const handle = new DbHandle(where);
        await startStdioServer({
          ...where,
          contractChecker: contractsHook(() => {
            const opened = handle.open();
            return 'error' in opened ? undefined : opened.db;
          }),
        });
      },
    );
};
