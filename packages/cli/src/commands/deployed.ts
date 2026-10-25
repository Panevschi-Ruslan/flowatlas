/**
 * `flowatlas deployed set|show` — the pins file, kept by hand or by a pipeline (P117).
 *
 * `set` records which ref of a service now runs in an environment; with
 * `--resolve` it records the commit, so the file names what ran rather than a
 * branch that will have moved by the time anybody reads it. `show` prints the
 * file with each ref's commit and how old it is, and says which refs are
 * branches. Neither touches a repository beyond reading its refs; `set`
 * writes the pins file and nothing else.
 */
import {
  DeployedInvalidError,
  deployedPathOf,
  emptyDeployed,
  loadConfig,
  loadDeployed,
  withPin,
  writeDeployed,
  type Deployed,
  type LoadedConfig,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { relative } from 'node:path';
import { cannotRun } from '../exit.js';
import { commitDateOf, isGitRepo, refKindOf, resolveSha, type RefKind } from '../git/worktree.js';
import { processIo, type QueryIo } from '../query/answer.js';

export interface DeployedOptions {
  config?: string;
  /** The pins file, in place of `deployed.file` or `flowatlas.deployed.json`. */
  pins?: string;
  /** `set`: record the commit the ref names rather than the ref. */
  resolve?: boolean;
  /** `show`: the file as JSON, each pin with its commit, kind and age. */
  json?: boolean;
  /** `show`: what "now" is, for ages that are the same on two runs. */
  now?: string;
}

/** One pin as `show` reads it. */
export interface PinShown {
  service: string;
  ref: string;
  /** The commit it names now; null when the repository has no such ref. */
  sha: string | null;
  kind: RefKind | 'missing';
  committedAt: string | null;
  /** `3 days`, from the commit's date to now. */
  age: string | null;
  /** Why this pin may not say what runs: a branch, or a ref the repository does not have. */
  warning?: string;
}

export interface DeployedShown {
  pinsFile: string;
  environments: Record<string, PinShown[]>;
}

const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const servicesOf = (loaded: LoadedConfig): string[] => loaded.config.services.map((service) => service.name);

const pathOf = (loaded: LoadedConfig, options: DeployedOptions): string =>
  deployedPathOf(loaded.rootDir, loaded.config.deployed?.file, options.pins);

const read = (loaded: LoadedConfig, path: string): Deployed | null => {
  try {
    return loadDeployed(path, servicesOf(loaded));
  } catch (error) {
    // Never written over: a file that cannot be read is said, not taken for an empty one.
    if (error instanceof DeployedInvalidError) throw cannotRun(error.message, error.hint === undefined ? [] : [error.hint]);
    throw error;
  }
};

const said = (loaded: LoadedConfig, path: string): string => relative(loaded.rootDir, path).replace(/\\/g, '/') || path;

/** Records `ref` (or the commit it names, with `--resolve`) as what `environment` runs of `service`. */
export const runDeployedSet = async (
  environment: string,
  service: string,
  ref: string,
  options: DeployedOptions,
  io: QueryIo = processIo,
): Promise<{ file: string; ref: string; was: string | null }> => {
  if (!ENVIRONMENT_NAME.test(environment)) throw cannotRun(`${JSON.stringify(environment)} is not an environment name (letters, digits, ".", "_" and "-")`);
  const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: options.resolve === true });
  const configured = loaded.config.services.find((entry) => entry.name === service);
  if (configured === undefined) {
    throw cannotRun(`no service named ${JSON.stringify(service)}`, [`Known services: ${servicesOf(loaded).sort().join(', ')}.`]);
  }
  if (ref.trim() === '' || /\s/.test(ref)) throw cannotRun(`${JSON.stringify(ref)} is not a ref`);
  let recorded = ref;
  if (options.resolve === true) {
    const repo = loaded.repoDir(configured);
    const sha = (await isGitRepo(repo)) ? await resolveSha(repo, ref) : null;
    if (sha === null) {
      throw cannotRun(`${service}: ${ref} does not resolve in ${configured.repo}`, [`Fetch it first: git -C ${configured.repo} fetch --tags.`]);
    }
    recorded = sha;
  }
  const path = pathOf(loaded, options);
  const deployed = read(loaded, path) ?? emptyDeployed();
  const was = deployed.environments[environment]?.[service] ?? null;
  writeDeployed(path, withPin(deployed, environment, service, recorded));
  io.out(`${environment}: ${service} = ${recorded}${was === null ? '' : was === recorded ? ' (unchanged)' : ` (was ${was})`} in ${said(loaded, path)}\n`);
  return { file: path, ref: recorded, was };
};

const DAY = 24 * 60 * 60 * 1000;

/** `5 minutes`, `3 hours`, `12 days`: as precise as an age needs to be. */
export const ageOf = (from: string, now: number): string => {
  const ms = Math.max(now - Date.parse(from), 0);
  const unit = (value: number, one: string): string => `${value} ${one}${value === 1 ? '' : 's'}`;
  if (ms < 60 * 60 * 1000) return unit(Math.floor(ms / 60_000), 'minute');
  if (ms < DAY) return unit(Math.floor(ms / (60 * 60 * 1000)), 'hour');
  return unit(Math.floor(ms / DAY), 'day');
};

const WARNINGS: Partial<Record<PinShown['kind'], string>> = {
  branch: 'a branch, read as it is now; record the commit with flowatlas deployed set --resolve',
  missing: 'does not resolve here; fetch it first (git fetch --tags), or check will refuse to decide',
};

/** Every environment's pins (or one's), each with its commit, kind and age. */
export const deployedShownOf = async (loaded: LoadedConfig, path: string, environment: string | undefined, now: number): Promise<DeployedShown> => {
  const deployed = read(loaded, path);
  if (deployed === null) throw cannotRun(`no pins file at ${path}`, ['Record a deployment with flowatlas deployed set <env> <service> <ref>.']);
  const names = Object.keys(deployed.environments);
  if (environment !== undefined && !names.includes(environment)) {
    throw cannotRun(`no environment named ${JSON.stringify(environment)} in ${said(loaded, path)}`, [`Known environments: ${names.sort().join(', ') || 'none'}.`]);
  }
  const environments: Record<string, PinShown[]> = {};
  for (const name of environment === undefined ? names : [environment]) {
    const rows: PinShown[] = [];
    for (const [service, ref] of Object.entries(deployed.environments[name] ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const configured = loaded.config.services.find((entry) => entry.name === service);
      const repo = configured === undefined ? undefined : loaded.repoDir(configured);
      const sha = repo !== undefined && (await isGitRepo(repo)) ? await resolveSha(repo, ref) : null;
      const kind: PinShown['kind'] = sha === null || repo === undefined ? 'missing' : await refKindOf(repo, ref, sha);
      const committedAt = sha === null || repo === undefined ? null : await commitDateOf(repo, sha);
      const warning = WARNINGS[kind];
      rows.push({ service, ref, sha, kind, committedAt, age: committedAt === null ? null : ageOf(committedAt, now), ...(warning === undefined ? {} : { warning }) });
    }
    environments[name] = rows;
  }
  return { pinsFile: said(loaded, path), environments };
};

const pad = (text: string, width: number): string => text.padEnd(width);

/** The pins file as a table per environment. */
export const renderDeployedText = (shown: DeployedShown): string => {
  const lines: string[] = [`pins: ${shown.pinsFile}`];
  for (const [environment, rows] of Object.entries(shown.environments)) {
    lines.push('', environment);
    const width = { service: Math.max(...rows.map((row) => row.service.length), 1), ref: Math.max(...rows.map((row) => row.ref.length), 1) };
    for (const row of rows) {
      const cells = [
        pad(row.service, width.service),
        pad(row.ref, width.ref),
        pad(row.sha === null ? '—' : row.sha.slice(0, 8), 8),
        pad(row.kind, 7),
        row.age === null ? '' : `${row.age} old`,
      ];
      lines.push(`  ${cells.join('  ').trimEnd()}${row.warning === undefined ? '' : `  (${row.warning})`}`);
    }
    if (rows.length === 0) lines.push('  (nothing deployed)');
  }
  return `${lines.join('\n')}\n`;
};

export const runDeployedShow = async (environment: string | undefined, options: DeployedOptions, io: QueryIo = processIo): Promise<DeployedShown> => {
  const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  const shown = await deployedShownOf(loaded, pathOf(loaded, options), environment, now);
  io.out(options.json === true ? `${JSON.stringify(shown, null, 2)}\n` : renderDeployedText(shown));
  return shown;
};

export const registerDeployed = (program: Command): void => {
  const deployed = program.command('deployed').description('which ref of each service runs in each environment: the pins file check reads');
  deployed
    .command('set')
    .description('record the ref a service runs in an environment')
    .argument('<env>', 'the environment, e.g. prod')
    .argument('<service>', 'a configured service')
    .argument('<ref>', 'a tag, branch or sha in that service\'s repository')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--pins <path>', 'the pins file (default: deployed.file, or flowatlas.deployed.json beside the configuration)')
    .option('--resolve', 'record the commit the ref names, not the ref')
    .action(async (environment: string, service: string, ref: string, options: DeployedOptions) => {
      await runDeployedSet(environment, service, ref, options);
    });
  deployed
    .command('show')
    .description('print the pins file with each ref\'s commit and age')
    .argument('[env]', 'only this environment')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--pins <path>', 'the pins file (default: deployed.file, or flowatlas.deployed.json beside the configuration)')
    .option('--json', 'as JSON')
    .action(async (environment: string | undefined, options: DeployedOptions) => {
      await runDeployedShow(environment, options);
    });
};
