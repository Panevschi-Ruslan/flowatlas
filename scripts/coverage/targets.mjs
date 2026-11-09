/**
 * What a target is made of: one repository, or several read as one project.
 *
 * Most targets are one repository, written `repository`, `commit`, `read` and
 * `types` on the target itself, and the clone is the target's directory in the
 * cache. A system whose front end and back end - or whose services - live in
 * separate repositories is written with `repositories` instead: a list of the
 * same four fields, each with a `name` that is the directory its clone gets
 * under the target's, so the repositories sit side by side the way a person
 * working on the system checks them out and `flowatlas link` is handed every
 * read directory of every one of them as one project.
 *
 * Everything downstream speaks one spelling of a path: relative to the
 * target's directory. For a target of one repository that is the clone, as it
 * always was, so nothing about such a target moves; for a target of several it
 * is the repository's `name` and then the path inside its clone. The counting
 * rule, the gate, the extent and the hand labels all use it, which is what lets
 * one report answer for files of three repositories without a second notion of
 * where a file is.
 *
 * The normalisation is here rather than at each use, because a harness that
 * read `target.read` in one place and `target.repositories` in another would
 * measure a multi-repository target as half of itself without saying so.
 */
import { posix } from 'node:path';

/** A directory a repository's clone may be given: one plain segment. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class TargetError extends Error {}

/**
 * The repositories of one target, each as `{ dir, repository, commit, read,
 * types }`, where `dir` is where its clone sits relative to the target's
 * directory - `.` for a target of one repository.
 *
 * A target of several repositories that names one twice, names one with a path
 * rather than a word, or gives one nothing to read is refused here rather than
 * cloned: two clones in one directory, or one at `../`, is a measurement of
 * something other than what the list says.
 */
export const repositoriesOf = (target) => {
  if (!Array.isArray(target.repositories)) {
    return [
      {
        dir: '.',
        repository: target.repository,
        commit: target.commit ?? null,
        read: target.read ?? [],
        types: target.types ?? {},
      },
    ];
  }
  if (target.repositories.length === 0) {
    throw new TargetError(`${target.name}: \`repositories\` is empty`);
  }
  const seen = new Set();
  return target.repositories.map((entry) => {
    const dir = entry.name;
    if (typeof dir !== 'string' || !PLAIN.test(dir)) {
      throw new TargetError(
        `${target.name}: every repository needs a \`name\` that is one plain directory name, and one has ${JSON.stringify(dir)}`,
      );
    }
    if (seen.has(dir)) throw new TargetError(`${target.name}: two repositories are named ${dir}`);
    seen.add(dir);
    if (!Array.isArray(entry.read) || entry.read.length === 0) {
      throw new TargetError(`${target.name}: repository ${dir} reads nothing`);
    }
    return {
      dir,
      repository: entry.repository,
      commit: entry.commit ?? null,
      read: entry.read,
      types: entry.types ?? {},
    };
  });
};

/** Whether a target is several repositories. */
export const isMultiRepository = (target) => Array.isArray(target.repositories);

/** A path inside one repository's clone, spelled relative to the target's directory. */
export const inTarget = (repo, path) =>
  repo.dir === '.' ? path : posix.join(repo.dir, path === '.' ? '' : path) || '.';

/** Every read directory of the target, relative to the target's directory. */
export const readRootsOf = (target) =>
  repositoriesOf(target).flatMap((repo) => repo.read.map((path) => inTarget(repo, path)));

/** The declared service types, keyed by read directory relative to the target's directory. */
export const typesOf = (target) =>
  Object.fromEntries(
    repositoriesOf(target).flatMap((repo) =>
      Object.entries(repo.types).map(([path, type]) => [inTarget(repo, path), type]),
    ),
  );

/** The repositories not pinned yet, by a name a person can find in the list. */
export const unpinnedOf = (target) =>
  repositoriesOf(target)
    .filter((repo) => repo.commit === null || repo.commit === undefined)
    .map((repo) => (repo.dir === '.' ? target.name : `${target.name}/${repo.dir}`));

/**
 * Write a commit back onto the repository it was resolved for, for `--pin`.
 * The target's own fields for one repository, the entry's for several.
 */
export const pinRepository = (target, repo, commit) => {
  if (repo.dir === '.') {
    target.commit = commit;
    return;
  }
  const entry = target.repositories.find((candidate) => candidate.name === repo.dir);
  entry.commit = commit;
};

export { TargetError };
