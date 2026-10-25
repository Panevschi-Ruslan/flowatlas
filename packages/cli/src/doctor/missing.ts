/**
 * Where the repository that is probably missing may be on disk (P122).
 *
 * The groups come from the graph (`missingGroupsOf`, linker); this is the one
 * part that looks at the disk, and it looks only beside the configured
 * repositories - their parents, one level down - and in the directories
 * `--scan` names. Of each directory it reads the manifest and the setting
 * files at its top, as a build reads them (P77): never a line of its source.
 * A directory already configured is never offered.
 */
import { readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { loadConfig, readPackageJson, type HostAlias } from '@flowatlas/core';
import { missingKeyOf, sayEvidence, saySeen, saySignal, worthSaying, type MissingGroup, type MissingSeen } from '@flowatlas/linker';
import { readProjectSettings } from '../build/settings/index.js';
import { isComposeFile } from '../build/settings/files.js';
import { repoPathFor, suggestName } from '../commands/init.js';

/** What made a directory look like the missing repository. */
export const MATCHED_BY = ['package', 'directory', 'compose', 'hosts'] as const;
export type MatchedBy = (typeof MATCHED_BY)[number];

/** A directory that looks like a group's repository. */
export interface MissingCandidate {
  /** Absolute. */
  dir: string;
  /** Its manifest's name, when it has one. */
  name?: string;
  matchedBy: MatchedBy[];
}

/** What one directory says about itself: its name, its manifest's, and the hosts its files say it is reached at. */
interface Described {
  dir: string;
  name?: string;
  hosts: readonly HostAlias[];
}

/** Directories never offered: a build's output, installed packages, anything hidden. */
const NEVER = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp', 'out']);

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const childDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !NEVER.has(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/** Its manifest and the setting files at its top, read as a build reads them (P77), with the compose files beside the configuration. */
const describe = (dir: string, configDir: string): Described => {
  const pkg = readPackageJson(dir);
  const name = typeof pkg?.name === 'string' && pkg.name !== '' ? pkg.name : undefined;
  const label = suggestName(pkg ?? {}, dir);
  const settings = readProjectSettings({ services: [{ name: label, dir }], rootDir: configDir })[label];
  return { dir, ...(name === undefined ? {} : { name }), hosts: settings?.hosts ?? [] };
};

const unscoped = (pkg: string): string => (pkg.startsWith('@') ? (pkg.split('/')[1] ?? '') : pkg);

/** Each way a directory can be told to be a group's repository: a Strategy per `MatchedBy`. */
const MATCHERS: { readonly [K in MatchedBy]: (seen: Described, key: string) => boolean } = {
  package: (seen, key) => seen.name !== undefined && missingKeyOf(unscoped(seen.name)) === key,
  directory: (seen, key) => missingKeyOf(basename(seen.dir)) === key,
  compose: (seen, key) => seen.hosts.some((host) => isComposeFile(basename(host.file)) && missingKeyOf(host.host) === key),
  hosts: (seen, key) => seen.hosts.some((host) => !isComposeFile(basename(host.file)) && missingKeyOf(host.host) === key),
};

export interface CandidateOptions {
  /** Directories of the configured repositories, absolute: their parents are searched, and they are never offered. */
  configured: readonly string[];
  /** Where the configuration is, for the compose files kept beside it. */
  configDir: string;
  /** More directories to search, one level down (`--scan`). */
  scan?: readonly string[];
}

/**
 * The directories that look like each group's repository, aligned with
 * `groups`: every directory next to the configured repositories, and in the
 * scanned ones, read once whatever the number of groups.
 */
export const candidatesFor = (groups: readonly MissingGroup[], options: CandidateOptions): MissingCandidate[][] => {
  if (groups.length === 0) return [];
  const configured = new Set(options.configured.map(realOf));
  const parents = [...new Set([...options.configured.map((dir) => dirname(resolve(dir))), ...(options.scan ?? []).map((dir) => resolve(dir))])];
  const seen = new Map<string, Described>();
  for (const parent of parents) {
    for (const dir of childDirs(parent)) {
      const real = realOf(dir);
      if (configured.has(real) || seen.has(real)) continue;
      seen.set(real, describe(dir, options.configDir));
    }
  }
  const described = [...seen.values()].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return groups.map((group) =>
    described.flatMap((one): MissingCandidate[] => {
      const matchedBy = MATCHED_BY.filter((by) => MATCHERS[by](one, group.key));
      return matchedBy.length === 0 ? [] : [{ dir: one.dir, ...(one.name === undefined ? {} : { name: one.name }), matchedBy }];
    }),
  );
};

/**
 * What `flowatlas mcp` hands the server for `start_here`'s `missingRepos`
 * (P122): the same search `doctor` makes, each directory by its path relative
 * to the configuration. Nothing when no configuration can be read.
 */
export const missingCandidatesFor = (
  config: string | undefined,
): { missingCandidates?: (groups: readonly MissingGroup[]) => string[][] } => {
  let loaded;
  try {
    loaded = loadConfig(config ?? process.cwd(), { checkRepos: false });
  } catch {
    return {};
  }
  const { rootDir } = loaded;
  const configured = loaded.config.services.filter((service) => service.document === undefined).map((service) => loaded.repoDir(service));
  return {
    missingCandidates: (groups) =>
      candidatesFor(groups, { configured, configDir: rootDir }).map((found) => found.map((candidate) => repoPathFor(rootDir, candidate.dir))),
  };
};

/* ── As the report holds it, and as it is said ── */

/** One group as `doctor.json` holds it (`unresolved.missingRepos`). */
export interface MissingRepoEntry {
  token: string;
  score: number;
  places: number;
  kinds: string[];
  /** True for a lone package, channel, subscription or traffic with nothing on disk that looks like it: listed by `--missing` only. */
  weak: boolean;
  signals: Array<{
    kind: string;
    name: string;
    says: string;
    /** `seen` on a place of traffic (P144): what one blind-spot group reached, and over which window. */
    places: Array<{ service?: string; file?: string; line?: number; gapId?: string; seen?: MissingSeen }>;
  }>;
  /** `path` relative to the configuration, as `services[].repo` is written. */
  candidates: Array<{ path: string; name?: string; matchedBy: string[] }>;
}

/** A group and its directories, as the report holds them. */
export const missingEntryOf = (group: MissingGroup, candidates: readonly MissingCandidate[], configDir: string): MissingRepoEntry => ({
  token: group.token,
  score: group.score,
  places: group.places,
  kinds: [...group.kinds],
  weak: !worthSaying(group, candidates.length),
  signals: group.signals.map((signal) => ({
    kind: signal.kind,
    name: signal.name,
    says: saySignal(signal),
    places: signal.places.map((place) => ({ ...place })),
  })),
  candidates: candidates.map((candidate) => ({
    path: repoPathFor(configDir, candidate.dir),
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
    matchedBy: [...candidate.matchedBy],
  })),
});

export interface MissingSayOptions {
  /** Where the configuration is: candidates' paths in the report are relative to it. */
  configDir?: string;
  /** Where the command is run, which `flowatlas link` resolves a path against. */
  cwd?: string;
  /** The configuration file, named on the command when it is not the one `link` finds by default. */
  configPath?: string;
  /** Every place under every signal (`--missing`), rather than one line per signal. */
  everyPlace?: boolean;
  /** How a place is spelled: `where` from the text report. */
  placeSaid?: (place: { service?: string; file?: string; line?: number }) => string;
  indent?: string;
}

const linkCommand = (path: string, options: MissingSayOptions): string => {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.configDir === undefined || isAbsolute(path) ? resolve(cwd, path) : resolve(options.configDir, path);
  const typed = repoPathFor(cwd, dir);
  const config = options.configPath === undefined || resolve(options.configPath) === join(cwd, 'flowatlas.config.json')
    ? ''
    : ` --config ${repoPathFor(cwd, resolve(options.configPath)).replace(/^\.\//, '')}`;
  return `flowatlas link ${typed}${config}`;
};

const MATCH_SAID: { readonly [K in MatchedBy]: (name: string | undefined) => string } = {
  package: (name) => `package ${name ?? '?'}`,
  directory: () => 'its directory name',
  compose: () => 'a compose service built from it',
  hosts: () => 'a host its own files say it is reached at',
};

const candidateSaid = (candidate: MissingRepoEntry['candidates'][number]): string =>
  candidate.name === undefined
    ? 'no package.json; by its name only'
    : candidate.matchedBy.map((by) => MATCH_SAID[by as MatchedBy](candidate.name)).join(', ');

/** What a group says: the head, a line per signal (or every place), then where it may be. */
export const sayMissing = (entry: MissingRepoEntry, options: MissingSayOptions = {}): string[] => {
  const pad = options.indent ?? '';
  const lines = [`${pad}Probably missing: a repository for "${entry.token}" — ${sayEvidence(entry)}`];
  for (const signal of entry.signals) {
    lines.push(`${pad}  ${signal.says}`);
    if (options.everyPlace === true) {
      for (const place of signal.places) {
        const said = options.placeSaid?.(place) ?? `${place.service ?? ''} ${place.file ?? ''}:${place.line ?? '?'}`;
        // A place of traffic has no file: what it reached, and over which window, is where it is (P144).
        lines.push(`${pad}    ${place.seen === undefined ? said : `${said}: ${saySeen(place.seen)}`}`);
      }
    }
  }
  const [first, ...others] = entry.candidates;
  if (first === undefined) {
    lines.push(`${pad}  nothing next to the configured repositories looks like it; if it exists elsewhere, \`flowatlas link <path>\``);
  } else if (others.length === 0) {
    lines.push(`${pad}  ${first.path} looks like it (${candidateSaid(first)}): ${linkCommand(first.path, options)}`);
  } else {
    lines.push(`${pad}  ${entry.candidates.length} directories look like it; link the one it is:`);
    for (const candidate of entry.candidates) lines.push(`${pad}    ${candidate.path} (${candidateSaid(candidate)}): ${linkCommand(candidate.path, options)}`);
  }
  return lines;
};

/** The one sentence when no group is found. */
export const NOTHING_MISSING = 'nothing points at a repository that is not here';
