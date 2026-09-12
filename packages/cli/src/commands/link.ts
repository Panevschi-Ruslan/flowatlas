import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  CONFIG_FILENAME,
  DEFAULT_OUTPUT,
  FlowatlasError,
  loadConfig,
  parseConfig,
  readPackageJson,
  type FlowatlasConfig,
  type ServiceConfig,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { guessType, suggestName, toPosixRelative, UNKNOWN_TYPE } from './init.js';
import { installMcp, MCP_FILE, SERVER_KEY } from './mcp.js';

export interface LinkOptions {
  /** Where the configuration is, or should be written. */
  config?: string;
  /** Do not register the graph server in the repositories. */
  mcp?: boolean;
  /** Say what would change and change nothing. */
  dryRun?: boolean;
  print?: (message: string) => void;
}

export interface LinkResult {
  configPath: string;
  config: FlowatlasConfig;
  added: ServiceConfig[];
  already: ServiceConfig[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** An empty project, for the first `link` in a directory that has no config. */
const emptyConfig = (): FlowatlasConfig =>
  parseConfig({ services: [], sharedPackages: [], output: DEFAULT_OUTPUT });

/**
 * Reads the configuration, or invents an empty one.
 *
 * `link` is how a project starts as well as how it grows, so a missing
 * configuration is the first call rather than a mistake. Repository paths are
 * not checked here: one of them is about to be added.
 */
const openProject = (configPath: string): { config: FlowatlasConfig; existed: boolean } => {
  if (!existsSync(configPath)) return { config: emptyConfig(), existed: false };
  const loaded = loadConfig(configPath, { checkRepos: false });
  return { config: loaded.config, existed: true };
};

/** What a repository should be called and what it is, read from its manifest. */
const describe = (dir: string): { name: string; type: string } => {
  const pkg = readPackageJson(dir);
  if (pkg === undefined) {
    throw new FlowatlasError(
      'not-a-repository',
      `${dir} has no package.json`,
      'Point at the root of a repository, the directory holding its package.json.',
    );
  }
  return { name: suggestName(pkg, dir), type: guessType(pkg) };
};

/**
 * Puts repositories into one project.
 *
 * The unit that matters is the set: a service only means something next to the
 * ones it talks to. Naming them here rather than scanning for them is what
 * makes a project explicit, and adding the sixth repository later a command
 * rather than an edit.
 */
export const linkRepos = (paths: readonly string[], options: LinkOptions = {}): LinkResult => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const configPath = resolve(options.config ?? join(process.cwd(), CONFIG_FILENAME));
  const configDir = resolve(configPath, '..');
  const { config, existed } = openProject(configPath);

  const byPath = new Map(
    config.services.map((service) => [
      isAbsolute(service.repo) ? service.repo : resolve(configDir, service.repo),
      service,
    ]),
  );
  const byName = new Map(config.services.map((service) => [service.name, service]));

  const added: ServiceConfig[] = [];
  const already: ServiceConfig[] = [];

  for (const given of paths) {
    const dir = resolve(given);
    if (!existsSync(dir)) {
      throw new FlowatlasError('no-such-repository', `${dir} does not exist`, 'Check the path.');
    }

    const existing = byPath.get(dir);
    if (existing !== undefined) {
      already.push(existing);
      continue;
    }

    const { name: suggested, type } = describe(dir);
    // Two repositories can share a package name; the directory settles it.
    const name = byName.has(suggested) ? `${suggested}-${basename(dir)}` : suggested;
    const service: ServiceConfig = { name, repo: toPosixRelative(configDir, dir), type };
    byName.set(name, service);
    byPath.set(dir, service);
    added.push(service);
  }

  const services = [...byPath.values()].sort((a, b) => cmp(a.name, b.name));
  const next = parseConfig({ ...config, services });

  if (options.dryRun !== true) {
    writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  const verb = options.dryRun === true ? 'would join' : existed ? 'joined' : 'started';
  if (added.length === 0) print('Nothing new to join.');
  else print(`${verb} ${added.length} repositor${added.length === 1 ? 'y' : 'ies'}:`);
  for (const service of added) print(`  ${service.name.padEnd(16)} ${service.repo}  ${service.type}`);
  for (const service of already) print(`  ${service.name.padEnd(16)} already in the project`);

  const unknown = added.filter((service) => service.type === UNKNOWN_TYPE);
  if (unknown.length > 0) {
    print(`Could not tell the type of: ${unknown.map((s) => s.name).join(', ')}.`);
    print('Set it by hand if you know it; an unknown type is read by no extractor.');
  }

  print(`The project is now ${services.map((service) => service.name).join(', ')}.`);

  if (options.mcp !== false && options.dryRun !== true && services.length > 0) {
    print('Registering the graph server:');
    try {
      installMcp({ config: configPath, print });
    } catch (cause) {
      print(`Could not register it: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (added.length > 0 && options.dryRun !== true) print('Run `flowatlas build` to read them.');

  return { configPath, config: next, added, already };
};

export interface UnlinkResult {
  configPath: string;
  removed: ServiceConfig[];
}

/** Takes the flowatlas entry out of a repository, leaving any others alone. */
const forgetServer = (repoDir: string): boolean => {
  const path = join(repoDir, MCP_FILE);
  if (!existsSync(path)) return false;
  let file: { mcpServers?: Record<string, unknown> };
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> };
  } catch {
    return false;
  }
  if (file.mcpServers?.[SERVER_KEY] === undefined) return false;
  delete file.mcpServers[SERVER_KEY];
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  return true;
};

/**
 * Takes repositories out of the project.
 *
 * Named rather than pathed, because by now they have names, and because
 * removing one is usually a decision about the project rather than about a
 * directory.
 */
export const unlinkRepos = (names: readonly string[], options: LinkOptions = {}): UnlinkResult => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const configPath = resolve(options.config ?? join(process.cwd(), CONFIG_FILENAME));
  const configDir = resolve(configPath, '..');
  const { config } = openProject(configPath);

  const wanted = new Set(names);
  const removed = config.services.filter((service) => wanted.has(service.name));
  const missing = [...wanted].filter(
    (name) => !config.services.some((service) => service.name === name),
  );
  if (missing.length > 0) {
    throw new FlowatlasError(
      'no-such-service',
      `not in this project: ${missing.join(', ')}`,
      `The project is ${config.services.map((service) => service.name).join(', ')}.`,
    );
  }

  const next = parseConfig({
    ...config,
    services: config.services.filter((service) => !wanted.has(service.name)),
  });

  if (options.dryRun !== true) {
    writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    for (const service of removed) {
      const dir = isAbsolute(service.repo) ? service.repo : resolve(configDir, service.repo);
      if (forgetServer(dir)) print(`  unregistered  ${join(dir, MCP_FILE)}`);
    }
  }

  print(`${options.dryRun === true ? 'would remove' : 'removed'} ${removed.map((s) => s.name).join(', ')}.`);
  print(
    next.services.length === 0
      ? 'The project is now empty.'
      : `The project is now ${next.services.map((service) => service.name).join(', ')}.`,
  );
  return { configPath, removed };
};

export const registerLink = (program: Command): void => {
  program
    .command('link')
    .argument('<repo...>', 'paths to the repositories that belong together')
    .description('put repositories into one project, and register the graph server in each')
    .option('--config <path>', `configuration file (default: ./${CONFIG_FILENAME})`)
    .option('--no-mcp', 'do not register the graph server')
    .option('--dry-run', 'say what would change and change nothing')
    .action((repos: string[], options: LinkOptions) => {
      linkRepos(repos, options);
    });

  program
    .command('unlink')
    .argument('<name...>', 'names of the services to remove')
    .description('take repositories out of the project')
    .option('--config <path>', `configuration file (default: ./${CONFIG_FILENAME})`)
    .option('--dry-run', 'say what would change and change nothing')
    .action((names: string[], options: LinkOptions) => {
      unlinkRepos(names, options);
    });
};
