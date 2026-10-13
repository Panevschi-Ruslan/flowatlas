/**
 * What `init` says about the repositories nothing here reads (R170).
 *
 * Pointed at a directory of a hundred repositories, `init` used to print a
 * hundred names after "Could not tell the type of:", which is a wall nobody
 * reads, and the one thing it could have said about them — what they have in
 * common — it never said. A few are still named, because five names are read;
 * past that they are counted and grouped, and `--list-unknown` names every one.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { allDependencies, readPackageJson, workspaceGlobs, type PackageJson } from '@flowatlas/core';
import { importableByName } from '../stacks.js';

/** Up to this many repositories nothing reads are named; more are summarised. */
export const NAMED_AT_MOST = 5;

/** One repository nothing reads, as `init` proposed it. */
export interface Unread {
  readonly name: string;
  readonly absPath: string;
  /** The stack it was recognised as, when it was; absent when nothing gave it away. */
  readonly unread?: string;
}

interface Seen {
  readonly dir: string;
  readonly pkg: PackageJson;
}

/**
 * What a group of repositories may have in common, each a claim its own files
 * make. Each is counted over the repositories it is true of, and said only
 * where it is true of some; a new one is a row here.
 */
const TRAITS: ReadonlyArray<readonly [said: string, test: (seen: Seen) => boolean]> = Object.freeze([
  ['declare no dependency at all', ({ pkg }) => Object.keys(allDependencies(pkg)).length === 0],
  ['are libraries: their package.json says how to import them', ({ pkg }) => importableByName(pkg)],
  ['declare a workspace with no application in it', ({ dir }) => workspaceGlobs(dir).length > 0],
  ['have no tsconfig.json, so may hold no TypeScript at all', ({ dir }) => !existsSync(join(dir, 'tsconfig.json'))],
]);

/** How many of the most declared dependencies to name. */
const COMMON_DEPENDENCIES = 3;

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** Each value with how often it occurs, the commonest first and ties by name. */
const tally = (values: readonly string[]): Array<readonly [value: string, count: number]> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
};

/** `Vue (8), Svelte (1)`. */
const counted = (entries: ReadonlyArray<readonly [value: string, count: number]>): string =>
  entries.map(([value, count]) => `${value} (${count})`).join(', ');

/** What the repositories nothing could tell the type of have in common, a line each. */
const inCommon = (unknown: readonly Unread[]): string[] => {
  const seen: Seen[] = unknown.map((each) => ({ dir: each.absPath, pkg: readPackageJson(each.absPath) ?? {} }));
  const traits = TRAITS.map(([said, test]) => [said, seen.filter(test).length] as const)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([said, count]) => `  ${count} ${said}`);
  const declared = seen.flatMap(({ pkg }) => Object.keys(allDependencies(pkg)));
  // Only a dependency more than one of them declares is something they have in common.
  const shared = tally(declared)
    .filter(([, count]) => count > 1)
    .slice(0, COMMON_DEPENDENCIES);
  return [
    ...traits,
    ...(shared.length === 0 ? [] : [`  the dependencies they declare most: ${counted(shared)}`]),
  ];
};

/**
 * The lines `init` prints about the repositories nothing reads.
 *
 * `named` names every one, as a short list is and as `--list-unknown` asks; the
 * summary is for the case where the names are too many to read.
 */
export const unreadSummary = (
  unread: readonly Unread[],
  options: { readable: readonly string[]; named: boolean },
): string[] => {
  const recognised = unread.filter((each) => each.unread !== undefined);
  const unknown = unread.filter((each) => each.unread === undefined);
  const { named } = options;
  const lines: string[] = [];

  // Being told which stack it found and that there is no reader for it is the
  // difference between a graph somebody can judge and one that quietly leaves a
  // repository out. It is said here, where the configuration is written, and
  // again on every build, where the counts are.
  if (recognised.length > 0) {
    lines.push(
      named
        ? `No reader yet for: ${recognised.map((each) => `${each.name} (${each.unread ?? ''})`).join(', ')}.`
        : `No reader yet for ${plural(recognised.length, 'repository', 'repositories')}: ${counted(tally(recognised.map((each) => each.unread ?? '')))}.`,
    );
    lines.push(`flowatlas reads repositories of type ${options.readable.join(' and ')} today.`);
    lines.push('Those repositories stay in the configuration and contribute nothing to the graph.');
  }
  if (unknown.length > 0) {
    if (named) {
      lines.push(`Could not tell the type of: ${unknown.map((each) => each.name).join(', ')}.`);
    } else {
      lines.push(`Could not tell the type of ${plural(unknown.length, 'repository', 'repositories')}. Of those:`);
      lines.push(...inCommon(unknown));
    }
    lines.push('Detection is only a suggestion. Set the type by hand if you know it.');
  }
  if (!named) {
    lines.push('Run init again with --list-unknown to name every one; each is in the configuration with its type.');
  }
  return lines;
};
