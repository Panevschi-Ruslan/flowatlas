/**
 * One sentence saying that a read was partial, for the place a reader meets the
 * run (R129).
 *
 * A repository whose dependencies are not installed reads *successfully*. The
 * files parse, the classes are found, and everything their types were going to
 * say is missing. What a reader gets instead is hundreds of `type-unresolved`
 * rows, from which they infer a partial read, or do not. Nobody is told once,
 * plainly, at the top - and this is the opposite of a row: it is the thing those
 * hundreds of rows already imply, said once where it cannot be missed.
 *
 * ## Why it is worded the way it is
 *
 * The obvious sentence - "install your dependencies to see your data layer" -
 * was the honest summary until R122 measured it. R122 recovered 66-96% of the
 * installed query count and 80-93% of the tables from what a repository's own
 * source states, so most of a data layer is now readable either way. What is
 * left is a package's business: what a table is called is usually declared in a
 * package, and a package that is not installed cannot be read. That residue is
 * a smaller and more useful thing to tell somebody than the whole data layer.
 *
 * ## The case this deliberately does not claim to tell apart
 *
 * There is a third state neither reading covers. One target is 0 tables with its
 * dependencies absent and 0 with them installed - on the target with the largest
 * denominator the coverage rule has - because its client is *generated* by a
 * postinstall. Installing changes nothing there, so a sentence promising that an
 * install would recover the residue is, for that reader, advice that does not
 * help them.
 *
 * The run cannot tell the two apart. With no `node_modules` there is nothing to
 * look at: whether a package would have declared the missing type or would have
 * generated it is a fact about a package that is not on the disk. A guess is
 * available - a `postinstall` script in a manifest - and it is declined, because
 * whether a postinstall generates the types *this read wanted* is exactly the
 * judgement a guess cannot make, and a confident wrong sentence is worse here
 * than a narrower right one.
 *
 * So the sentence is narrowed until it is true of every repository it can be
 * printed in front of: it says what an install recovers, which is what a package
 * declares, and it says in the same breath what an install does not, which is
 * what a package generates. Neither clause depends on knowing which case this
 * repository is.
 *
 * ## When it is printed
 *
 * Only when there is no `node_modules` *and* something went unresolved. Both
 * halves matter. Without the first it would fire on a repository that is
 * installed and still unresolved, where "install your dependencies" is plainly
 * wrong. Without the second it would fire on a repository that read fine, where
 * it is noise.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** One repository, as the caller knows it: what to call it, and where it is. */
export interface ReadRepo {
  /** What to call it in the sentence - a service name, or a repository id. */
  readonly name: string;
  /** Where it is on disk, so the state can be established rather than assumed. */
  readonly dir: string;
}

/**
 * Whether a directory has had an install.
 *
 * Injected rather than imported at the call site, so the sentence can be tested
 * without a tree on disk, and so the one filesystem question this module asks is
 * in one place. The presence of `node_modules` is a coarse instrument and the
 * right one: the question is not "is every dependency present" - which only the
 * checker can answer, and which is what the unresolved rows are - but "has
 * anybody run an install here at all".
 */
export const isInstalled = (dir: string): boolean => existsSync(join(dir, 'node_modules'));

/** `a`, `a and b`, `a, b and c` - so the sentence reads as a sentence. */
const list = (names: readonly string[]): string =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const subject = (names: readonly string[]): string =>
  names.length === 1
    ? `${names[0]}’s dependencies are not installed`
    : `The dependencies of ${list(names)} are not installed`;

/**
 * The sentence, or nothing when there is nothing to say.
 *
 * Returns one string rather than printing, because the three places it belongs
 * print differently - `extract` and `build` add a line to a summary, `doctor`
 * puts it above its own first line - and a module that owned the writing as well
 * as the wording would have to know about all three.
 *
 * `sites` is the whole run's count of types that went unresolved, and the
 * sentence does not attribute it to the repositories it names. That is on
 * purpose: `doctor` reads a folded report and cannot say how many of the 912
 * belong to which repository, and a sentence written to need that number would
 * either be unavailable there or be wrong there. Naming the state and stating
 * the count are two true clauses; dividing one by the other would be a third
 * claim nobody measured.
 */
export const partialReadNotice = (
  repos: readonly ReadRepo[],
  sites: number,
  installed: (dir: string) => boolean = isInstalled,
): string | undefined => {
  if (sites <= 0) return undefined;
  const uninstalled = repos.filter((repo) => repo.dir !== '' && !installed(repo.dir));
  if (uninstalled.length === 0) return undefined;
  return (
    `${subject(uninstalled.map((repo) => repo.name))}, and ${sites} type${sites === 1 ? '' : 's'} ` +
    'could not be resolved: this is a partial read. What a table is called is usually declared ' +
    'in a package, and a package that is not installed cannot be read. Installing them and ' +
    'building again recovers what a package declares — never what a package generates, which ' +
    'is absent either way.'
  );
};
