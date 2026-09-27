import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  CONFIG_FILENAME,
  DEFAULT_OUTPUT,
  FlowatlasError,
  parseConfig,
  readPackageJson,
  workspaceGlobs,
  workspacePackages,
  workspaceRootOf,
  type FlowatlasConfig,
  type PackageJson,
} from '@flowatlas/core';
import type { Command } from 'commander';
import {
  guessUnread,
  guessWorkspaceType,
  looksLikeApplication,
  UNKNOWN_TYPE,
} from '../stacks.js';
import { READABLE_TYPES } from '../readers.js';
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
  /**
   * The name the manifest declares, scope and all.
   *
   * Kept beside the suggested name because the scope is what tells two members of
   * one workspace apart when the suggestion drops it and they collide.
   */
  declared?: string;
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
 * The same list, with no two services sharing a name.
 *
 * A service name is the key everything else in the configuration refers to, and
 * two of them the same is a configuration the schema refuses — which, now that
 * one directory can yield several services, is something a scan can produce
 * without anybody doing anything wrong: `@shop/web` and `@admin/web` are two
 * members of one workspace and both are called `web` once the scope is dropped.
 *
 * What tells them apart is the scope the name was declared with, so the scope
 * comes back: `shop-web`. A package with no scope to fall back on is named by the
 * directory it is in instead. The first of a repeated name keeps the plain one,
 * because renaming a service that was never ambiguous would be a worse surprise
 * than a long name, and this is a suggestion somebody is about to read anyway.
 */
const withDistinctNames = (candidates: readonly Candidate[]): Candidate[] => {
  const taken = new Set<string>();
  return candidates.map((candidate) => {
    if (!taken.has(candidate.name)) {
      taken.add(candidate.name);
      return candidate;
    }
    const scope = candidate.declared?.startsWith('@') === true
      ? candidate.declared.slice(1).split('/')[0]
      : basename(resolve(candidate.absPath, '..'));
    let name = `${scope}-${candidate.name}`;
    for (let nth = 2; taken.has(name); nth += 1) name = `${scope}-${candidate.name}-${nth}`;
    taken.add(name);
    return { ...candidate, name };
  });
};

/**
 * The services one directory holds, which is not always one.
 *
 * A directory with a manifest used to be a service, exactly one, and R107 is
 * what that cost. Run against PeerTube, `init` wrote a single service and
 * silently left out the Angular client that is half the repository, because the
 * client is a directory below the one the manifest was in. Both halves are
 * declared, in `pnpm-workspace.yaml`, and had been all along.
 *
 * So a directory that declares a workspace is asked what is in it, and every
 * member that is an application — rather than a library the applications import —
 * becomes a service of its own. A directory that declares no workspace, and a
 * workspace with no application in it, are one service as before: the second
 * case matters, because a repository of nothing but libraries still has code
 * worth reading and offering nothing at all would be a worse answer than
 * offering the whole of it.
 *
 * A member that is itself the root of a nested workspace — PeerTube's `client`
 * declares members of its own — is read as the application it is, because the
 * question asked of it is whether it looks like one and not what is beneath it.
 */
const servicesIn = (absPath: string, configDir: string, pkg: PackageJson): Candidate[] => {
  const asOne = (dir: string, manifest: PackageJson, root?: PackageJson): Candidate => {
    const type = guessWorkspaceType(manifest, root);
    const unread = type === UNKNOWN_TYPE ? guessUnread(manifest) : undefined;
    return {
      absPath: dir,
      repo: toPosixRelative(configDir, dir),
      name: suggestName(manifest, dir),
      ...(typeof manifest.name === 'string' ? { declared: manifest.name } : {}),
      type,
      ...(unread === undefined ? {} : { unread }),
    };
  };

  if (workspaceGlobs(absPath).length === 0) {
    // A directory scanned on its own may still be a member of a workspace
    // somewhere above it — `init --dir peertube` finds `server` and `client` as
    // ordinary subdirectories — and a member's type is read the same way whether
    // the scan arrived from above it or beside it. Anything else would make the
    // suggestion depend on where the person happened to stand.
    const above = workspaceRootOf(absPath);
    return [asOne(absPath, pkg, above === undefined ? undefined : readPackageJson(above))];
  }

  const found: Candidate[] = [];
  for (const member of workspacePackages(absPath)) {
    const manifest = readPackageJson(member.dir);
    if (manifest === undefined || !looksLikeApplication(manifest, pkg)) continue;
    found.push(asOne(member.dir, manifest, pkg));
  }
  // A workspace whose members include applications is a workspace and not one of
  // them: offering the root as well would read every application twice, once on
  // its own and once as part of the whole. PeerTube is the case — its root
  // declares Express because that is where the server's dependencies are kept,
  // so the root looks exactly like the server it is not.
  return found.length === 0 ? [asOne(absPath, pkg)] : found;
};

/**
 * Looks for repositories directly under `scanDir`.
 *
 * A directory counts when it holds a `package.json`, and may hold more than one
 * service: see {@link servicesIn}. The directory holding the configuration is
 * skipped, so the tool never lists itself as a service.
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
    found.push(...servicesIn(absPath, self, pkg));
  }
  // By name, and then by where it is, because a workspace can hold two members
  // whose manifests were copied from each other and a list that reordered
  // between runs would make every snapshot of it a coin toss.
  const sorted = found.sort((a, b) =>
    a.name === b.name ? (a.repo < b.repo ? -1 : 1) : a.name < b.name ? -1 : 1,
  );
  return withDistinctNames(sorted);
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
    const picked = await select({
      message: `Type of ${name}`,
      choices: [...READABLE_TYPES, UNKNOWN_TYPE].map((type) => ({ name: type, value: type })),
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
      `flowatlas reads repositories of type ${READABLE_TYPES.join(' and ')} today.`,
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
