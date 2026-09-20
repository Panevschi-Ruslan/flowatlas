import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  CONFIG_FILENAME,
  DEFAULT_OUTPUT,
  FlowatlasError,
  parseConfig,
  readPackageJson,
  type FlowatlasConfig,
  type PackageJson,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { guessType, guessUnread, TYPE_SIGNATURES, UNKNOWN_TYPE } from '../stacks.js';
import { installMcp } from './mcp.js';

/** Directories that are never a service of their own. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

export interface Candidate {
  /** Absolute path of the repository. */
  absPath: string;
  /** Path as it will be written to the configuration, relative and POSIX. */
  repo: string;
  /** Suggested service name. */
  name: string;
  /** Suggested type, or `unknown` when nothing gave it away. */
  type: string;
  /** The framework found when there is no reader for it. Absent otherwise. */
  unread?: string;
}

/** `@scope/name` becomes `name`; anything unusable falls back to the directory. */
export const suggestName = (pkg: PackageJson, dir: string): string => {
  const declared = typeof pkg.name === 'string' ? pkg.name.trim() : '';
  const withoutScope = declared.startsWith('@') ? (declared.split('/')[1] ?? '') : declared;
  return withoutScope !== '' ? withoutScope : basename(dir);
};

/**
 * A directory by the name the file system really calls it.
 *
 * Every path this command writes is relative to the configuration, and every
 * path `build` reads is resolved against where the configuration really is. If
 * one of them goes through a symbolic link and the other does not, they disagree
 * by however many levels the link skips: on macOS `--out /tmp/x/…` wrote paths
 * relative to `/tmp/x` and `build` resolved them against `/private/tmp/x`, so
 * every service failed to validate on the first build. Resolving both ends the
 * same way is the whole fix.
 *
 * Falls back to the path as given when it does not exist yet, because a
 * directory that is not there cannot be resolved and the caller is about to get
 * a better error about it anyway.
 */
const trueDir = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** A path as the configuration writes it: relative to the config, POSIX. */
export const toPosixRelative = (from: string, to: string): string => {
  const rel = relative(from, to).split(sep).join('/');
  if (rel === '') return '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/**
 * Looks for repositories directly under `scanDir`.
 *
 * A directory counts when it holds a `package.json`. The directory holding the
 * configuration is skipped, so the tool never lists itself as a service.
 */
export const scanCandidates = (scanDir: string, configDir: string): Candidate[] => {
  const root = resolve(scanDir);
  const self = resolve(configDir);
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (cause) {
    throw new FlowatlasError(
      'scan-failed',
      `Cannot read ${root}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'Pass an existing directory with --dir.',
    );
  }

  const found: Candidate[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIPPED.has(entry)) continue;
    const absPath = join(root, entry);
    if (absPath === self) continue;
    const pkg = readPackageJson(absPath);
    if (pkg === undefined) continue;
    const type = guessType(pkg);
    const unread = type === UNKNOWN_TYPE ? guessUnread(pkg) : undefined;
    found.push({
      absPath,
      repo: toPosixRelative(self, absPath),
      name: suggestName(pkg, absPath),
      type,
      ...(unread === undefined ? {} : { unread }),
    });
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

export interface InitOptions {
  /** Also register the graph server in each repository. Defaults to true. */
  mcp?: boolean;
  /** Directory to scan for repositories. Defaults to the parent of the output. */
  dir?: string;
  /** Where to write the configuration. Defaults to `./flowatlas.config.json`. */
  out?: string;
  /** Accept every suggestion without asking. */
  yes?: boolean;
  /** Overwrite an existing configuration. */
  force?: boolean;
  /** Where messages go. Defaults to stdout. */
  print?: (message: string) => void;
}

export interface InitResult {
  configPath: string;
  config: FlowatlasConfig;
  candidates: Candidate[];
}

const buildConfig = (candidates: readonly Candidate[]): FlowatlasConfig =>
  parseConfig({
    services: candidates.map(({ name, repo, type }) => ({ name, repo, type })),
    sharedPackages: [],
    adapters: { auto: true, force: {} },
    output: DEFAULT_OUTPUT,
  });

/** Interactive refinement. Loaded lazily so `--yes` never needs a terminal. */
const refine = async (candidates: readonly Candidate[]): Promise<Candidate[]> => {
  const { checkbox, input, select } = await import('@inquirer/prompts');
  if (candidates.length === 0) return [];

  const chosen = await checkbox({
    message: 'Which repositories belong to this project?',
    choices: candidates.map((candidate) => ({
      name: `${candidate.name}  (${candidate.repo}, ${candidate.unread === undefined ? candidate.type : `${candidate.unread}, no reader yet`})`,
      value: candidate,
      checked: candidate.type !== UNKNOWN_TYPE,
    })),
  });

  const refined: Candidate[] = [];
  for (const candidate of chosen) {
    const name = await input({ message: `Service name for ${candidate.repo}`, default: candidate.name });
    const known = TYPE_SIGNATURES.map(([type]) => type);
    const picked = await select({
      message: `Type of ${name}`,
      choices: [...known, UNKNOWN_TYPE].map((type) => ({ name: type, value: type })),
      default: candidate.type,
    });
    // Picking a type by hand answers the question `unread` was asking. Keeping
    // it would print "no reader yet" beside a repository that is about to be
    // read in full.
    const { unread: _guessed, ...rest } = candidate;
    refined.push({
      ...rest,
      name,
      type: picked,
      ...(picked === UNKNOWN_TYPE && candidate.unread !== undefined
        ? { unread: candidate.unread }
        : {}),
    });
  }
  return refined;
};

export const runInit = async (options: InitOptions = {}): Promise<InitResult> => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const asked = resolve(options.out ?? join(process.cwd(), CONFIG_FILENAME));
  const configDir = trueDir(resolve(asked, '..'));
  const configPath = join(configDir, basename(asked));
  const scanDir = trueDir(resolve(options.dir ?? join(configDir, '..')));

  if (existsSync(configPath) && options.force !== true) {
    throw new FlowatlasError(
      'config-exists',
      `${configPath} already exists.`,
      'Pass --force to overwrite it.',
    );
  }

  const candidates = scanCandidates(scanDir, configDir);
  if (options.yes !== true && candidates.length > 0 && process.stdin.isTTY !== true) {
    throw new FlowatlasError(
      'not-interactive',
      'Cannot ask which repositories to include: this terminal is not interactive.',
      'Re-run with --yes to accept every suggestion.',
    );
  }
  const selected = options.yes === true ? [...candidates] : await refine(candidates);
  const config = buildConfig(selected);

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  if (selected.length === 0) {
    print(`No repositories found under ${scanDir}.`);
    print('Wrote an empty configuration. Add services by hand, or re-run with --dir <parent>.');
  } else {
    print(`Wrote ${configPath} with ${selected.length} service(s):`);
    for (const service of selected) {
      const found = service.unread === undefined ? '' : `  (looks like ${service.unread})`;
      print(`  ${service.name}  ${service.repo}  ${service.type}${found}`);
    }
  }

  // Being told which stack it found and that there is no reader for it is the
  // difference between a graph somebody can judge and one that quietly leaves a
  // repository out. It is said here, where the configuration is written, and
  // again on every build, where the counts are.
  const unread = selected.filter((service) => service.unread !== undefined);
  if (unread.length > 0) {
    const named = unread.map((service) => `${service.name} (${service.unread ?? ''})`).join(', ');
    print(`No reader yet for: ${named}.`);
    print(
      `flowatlas reads repositories of type ${TYPE_SIGNATURES.map(([type]) => type).join(' and ')} today.`,
    );
    print('Those repositories stay in the configuration and contribute nothing to the graph.');
  }
  const unknown = selected.filter(
    (service) => service.type === UNKNOWN_TYPE && service.unread === undefined,
  );
  if (unknown.length > 0) {
    print(`Could not tell the type of: ${unknown.map((s) => s.name).join(', ')}.`);
    print('Detection is only a suggestion. Set the type by hand if you know it.');
  }

  // The repositories are known now, and the point of the tool is that a session
  // in any of them can ask about all of them. Registering the server is the last
  // step of setting up, not something to look up later.
  if (selected.length > 0 && options.mcp !== false) {
    print('Registering the graph server:');
    try {
      installMcp({ config: configPath, print });
    } catch (cause) {
      print(`Could not register it: ${cause instanceof Error ? cause.message : String(cause)}`);
      print('Run `flowatlas mcp --install` once the repositories are in place.');
    }
  }

  return { configPath, config, candidates };
};

export const registerInit = (program: Command): void => {
  program
    .command('init')
    .description('create flowatlas.config.json by looking for repositories next to this one')
    .option('--dir <path>', 'directory to scan for repositories (default: parent of the output)')
    .option('--out <file>', `where to write the configuration (default: ./${CONFIG_FILENAME})`)
    .option('-y, --yes', 'accept every suggestion without asking')
    .option('--force', 'overwrite an existing configuration')
    .option('--no-mcp', 'do not register the graph server in the repositories')
    .action(async (opts: InitOptions) => {
      await runInit(opts);
    });
};
