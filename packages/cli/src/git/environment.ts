/**
 * What an environment runs, read as a side of a comparison (P117, P193).
 *
 * `check --env` and `diff --env` read the same thing: every service at the
 * ref the environment pins (the pins file, `FLOWATLAS_PIN_<SERVICE>`, then
 * `--pin`), and beside it the same project with the services that move at
 * the head. A pin that names nothing to read is refused, never read as the
 * working tree in its place (I3): an answer about what runs somewhere cannot
 * assume anything about what runs there.
 */
import { relative } from 'node:path';
import {
  DeployedInvalidError,
  deployedPathOf,
  loadDeployed,
  parsePinFlags,
  pinsFor,
  pinsFromEnv,
  type Deployed,
  type LoadedConfig,
  type Pin,
} from '@flowatlas/core';
import type { CheckMove, CheckPin, CheckRefusal } from '@flowatlas/linker';
import { cannotRun } from '../exit.js';
import { buildAtRef, UnreadableAtRef, type BuildAtRefOptions, type BuildAtRefResult } from './build-at-ref.js';
import { isDirty, isGitRepo, resolveSha } from './worktree.js';

/** What an environment may be called: the pins file's own rule. */
export const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `--env <name>` as given, or a refusal saying what a name may hold. */
export const environmentNameOf = (name: string): string => {
  if (!ENVIRONMENT_NAME.test(name)) throw cannotRun(`--env ${JSON.stringify(name)} is not an environment name (letters, digits, ".", "_" and "-")`);
  return name;
};

const short = (sha: string | null): string => (sha === null ? 'working tree' : sha.slice(0, 8));

/** Where a run reads its pins from, as flags say it. */
export interface PinFlags {
  /** `<service>=<ref>`, over the pins file and the environment variables. */
  pin?: string[];
  /** The pins file, in place of `deployed.file` or `flowatlas.deployed.json`. */
  pins?: string;
  /** Where `FLOWATLAS_PIN_*` are read from; the process's environment when absent. */
  environ?: Readonly<Record<string, string | undefined>>;
}

/** What a run reads the pins of every environment from. */
export interface PinSources {
  deployed: Deployed | null;
  /** The pins file, relative to the configuration, when there is one. */
  file: string | null;
  env: Record<string, string>;
  flags: Record<string, string>;
}

export const pinSourcesOf = (loaded: LoadedConfig, options: PinFlags): PinSources => {
  const services = loaded.config.services.map((service) => service.name);
  const path = deployedPathOf(loaded.rootDir, loaded.config.deployed?.file, options.pins);
  let deployed: Deployed | null;
  try {
    deployed = loadDeployed(path, services);
  } catch (error) {
    if (error instanceof DeployedInvalidError) throw cannotRun(error.message, error.hint === undefined ? [] : [error.hint]);
    throw error;
  }
  if (deployed === null && options.pins !== undefined) throw cannotRun(`no pins file at ${path}`);
  const flags = parsePinFlags(options.pin ?? [], services);
  if (flags.problems.length > 0) throw cannotRun(flags.problems[0] ?? 'a --pin is not <service>=<ref>', flags.problems.slice(1));
  return {
    deployed,
    file: deployed === null ? null : relative(loaded.rootDir, path).replace(/\\/g, '/') || path,
    env: pinsFromEnv(options.environ ?? process.env, services),
    flags: flags.pins,
  };
};

export const FROM_SAID: Readonly<Record<Pin['from'], string>> = { file: 'the pins file', env: 'FLOWATLAS_PIN_*', flag: '--pin' };

/**
 * Every pin resolved to a commit, or the refusals that make the environment
 * unreadable: a ref the repository does not have (fetch its tags first), or
 * a service that is a directory inside a repository rather than one.
 */
const resolvePins = async (loaded: LoadedConfig, pins: readonly Pin[]): Promise<{ resolved: CheckPin[]; refusals: CheckRefusal[] }> => {
  const resolved: CheckPin[] = [];
  const refusals: CheckRefusal[] = [];
  for (const pin of pins) {
    const service = loaded.config.services.find((entry) => entry.name === pin.service);
    if (service === undefined) continue;
    const repo = loaded.repoDir(service);
    const sha = (await isGitRepo(repo)) ? await resolveSha(repo, pin.ref) : null;
    resolved.push({ service: pin.service, ref: pin.ref, from: pin.from, sha, ...(pin.replaced === undefined ? {} : { replaced: pin.replaced }) });
    if (sha !== null) continue;
    refusals.push(
      (await isGitRepo(repo))
        ? {
            reason: 'ref-not-found',
            service: pin.service,
            message: `${pin.service}: ${pin.ref} (from ${FROM_SAID[pin.from]}) does not resolve in ${service.repo}`,
            hint: `Fetch it first: git -C ${service.repo} fetch --tags (in CI, check out with fetch-depth: 0).`,
          }
        : {
            reason: 'not-a-git-repo',
            service: pin.service,
            message: `${pin.service}: ${service.repo} is not a git repository root, so it cannot be read at ${pin.ref}`,
            hint: 'Every deployed service is read at its ref; point the service at the root of its repository.',
          },
    );
  }
  return { resolved, refusals };
};

/**
 * The services the head side reads somewhere else than their pin.
 *
 * Named ones (`--service`) move unless their head is their pin, which is said
 * ("nothing to deploy for orders"); without names, every pinned service whose
 * head is a different commit, or the same one with uncommitted changes when
 * the head is the working tree. A head ref one repository does not have
 * leaves that service as deployed, and says so.
 */
const movesOf = async (
  loaded: LoadedConfig,
  pins: readonly CheckPin[],
  shipped: readonly string[] | undefined,
  head: string | null,
): Promise<{ moved: CheckMove[]; refusals: CheckRefusal[]; notes: string[] }> => {
  const moved: CheckMove[] = [];
  const refusals: CheckRefusal[] = [];
  const notes: string[] = [];
  const byService = new Map(pins.map((pin) => [pin.service, pin]));
  const candidates = shipped ?? pins.map((pin) => pin.service);
  for (const name of candidates) {
    const service = loaded.config.services.find((entry) => entry.name === name);
    if (service === undefined) continue;
    const repo = loaded.repoDir(service);
    const pin = byService.get(name);
    const git = await isGitRepo(repo);
    const sha = git ? await resolveSha(repo, head ?? 'HEAD') : null;
    if (head !== null && sha === null) {
      if (shipped !== undefined) {
        refusals.push({
          reason: 'head-not-found',
          service: name,
          message: `${name}: --head ${head} does not resolve in ${service.repo}`,
          hint: `Fetch it first (git -C ${service.repo} fetch), or name the ref that holds what ships.`,
        });
      } else {
        notes.push(`${name} has no ${head}: read as deployed on both sides`);
      }
      continue;
    }
    const dirty = head === null && git ? await isDirty(repo) : false;
    const from = { ref: pin?.ref ?? null, sha: pin?.sha ?? null };
    if (pin !== undefined && sha !== null && sha === pin.sha && !dirty) {
      if (shipped !== undefined) notes.push(`nothing to deploy for ${name}: ${head ?? 'its working tree'} is ${pin.ref} (${short(pin.sha)})`);
      continue;
    }
    if (pin === undefined) notes.push(`${name} is not deployed here yet: read on the candidate side only`);
    moved.push({ service: name, from, to: { ref: head, sha: head === null && dirty ? null : sha, dirty } });
  }
  return { moved, refusals, notes };
};

/** The notes a header owes the reader: whose ref replaced whose (§10). */
const pinNotes = (pins: readonly CheckPin[]): string[] =>
  pins.flatMap((pin) =>
    pin.replaced === undefined ? [] : [`${pin.service}: ${pin.ref} from ${FROM_SAID[pin.from]}, in place of ${pin.replaced.ref} from ${FROM_SAID[pin.replaced.from]}`],
  );

export interface EnvironmentContext {
  loaded: LoadedConfig;
  sources: PinSources;
  /** The services that move to the head. Without it, every one whose head differs from its pin. */
  shipped: readonly string[] | undefined;
  /** The ref the moving services are read at; the working tree when null. */
  head: string | null;
  /** Where both sides are read and from which cache; never falls back (I3). */
  build: Omit<BuildAtRefOptions, 'side' | 'services' | 'refFor' | 'inherit' | 'inheritSources' | 'fallback'>;
}

/** What an environment runs and what moves, with both sides when they could be read. */
export interface EnvironmentRead {
  pins: CheckPin[];
  moved: CheckMove[];
  /** Configured services the environment does not run and nothing moves to it. */
  notDeployed: string[];
  notes: string[];
  /** Why the environment could not be read; empty when `sides` is there. */
  refusals: CheckRefusal[];
  sides: { deployed: BuildAtRefResult; candidate: BuildAtRefResult } | null;
}

/** What `diff --env` says about the environment beside its document (P193): `check`'s header, without a verdict. */
export interface EnvironmentSaid {
  environment: string;
  /** The pins file, relative to the configuration, when there is one. */
  pinsFile: string | null;
  pins: CheckPin[];
  moved: CheckMove[];
  notDeployed: string[];
  notes: string[];
}

/**
 * One environment read: its pins resolved, what moves, and both sides built
 * the way `check` reads them - the deployed side every pinned service at its
 * pin, the candidate side the same with the moving services at the head.
 */
export const readEnvironment = async (environment: string, ctx: EnvironmentContext): Promise<EnvironmentRead> => {
  const { loaded, sources, head } = ctx;
  const { pins: wanted, known } = pinsFor(sources.deployed, environment, { env: sources.env, flags: sources.flags });
  const configured = loaded.config.services.map((service) => service.name);
  const notDeployed = configured.filter((name) => !wanted.some((pin) => pin.service === name)).sort();
  if (!known) {
    const named = Object.keys(sources.deployed?.environments ?? {}).sort();
    return {
      pins: [],
      moved: [],
      notDeployed,
      notes: [],
      refusals: [
        {
          reason: 'unknown-environment',
          service: null,
          message: `no environment named ${JSON.stringify(environment)}${sources.file === null ? ' and no pins file' : ` in ${sources.file}`}${named.length === 0 ? '' : ` (known: ${named.join(', ')})`}`,
          hint: `Record what runs there with flowatlas deployed set ${environment} <service> <ref>, or pass each running version with --pin <service>=<ref>.`,
        },
      ],
      sides: null,
    };
  }

  const { resolved, refusals } = await resolvePins(loaded, wanted);
  const moves = await movesOf(loaded, resolved, ctx.shipped, head);
  const described = {
    pins: resolved,
    moved: moves.moved,
    notDeployed: notDeployed.filter((name) => !moves.moved.some((move) => move.service === name)),
    notes: [...pinNotes(resolved), ...moves.notes],
  };
  if (refusals.length > 0 || moves.refusals.length > 0) return { ...described, refusals: [...refusals, ...moves.refusals], sides: null };

  const shared = { ...ctx.build, fallback: false };
  const pinned = new Map(resolved.map((pin) => [pin.service, pin.ref]));
  try {
    const deployed = await buildAtRef(loaded, null, {
      ...shared,
      side: 'base',
      services: resolved.map((pin) => pin.service),
      refFor: (service) => pinned.get(service) ?? null,
    });
    const candidate = await buildAtRef(loaded, null, {
      ...shared,
      side: 'head',
      services: moves.moved.map((move) => move.service),
      refFor: () => head,
      inherit: deployed.repoGraphs,
      inheritSources: deployed.sources,
    });
    return { ...described, refusals: [], sides: { deployed, candidate } };
  } catch (error) {
    // A ref that moved between resolving it and reading it: still never the working tree.
    if (!(error instanceof UnreadableAtRef)) throw error;
    return {
      ...described,
      refusals: [{ reason: error.reason, service: error.service, message: error.message, hint: `Fetch it first: git -C ${error.repo} fetch --tags.` }],
      sides: null,
    };
  }
};
