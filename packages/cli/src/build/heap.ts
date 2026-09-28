import { totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

/**
 * How much heap one reader is allowed, and who decides.
 *
 * A repository is read in a process of its own, and that process gets whatever
 * heap the runtime picked for itself from the machine it is on — about 4 GB on a
 * 36 GB laptop, whatever the size of the repository. The largest target this
 * tool is measured against needs more than twice that: a CMS monorepo
 * with its dependencies installed peaks at 10.0 GB of resident memory and
 * finishes under a 12 GB old-space limit, and dies under an 8 GB one. So the
 * default is not a limit anybody chose for this work; it is the limit nobody
 * chose, and the tool was dying of it.
 *
 * Three rules, and the order of them is the whole of this module:
 *
 * 1. **What the caller asked for wins.** A limit already on `NODE_OPTIONS`, on
 *    this process's own command line, or given to `build --heap` is an
 *    instruction, and a tool that quietly replaced it would be lying about what
 *    it ran. Anybody debugging a memory problem sets that flag first.
 * 2. **Never less than the runtime would have given.** A machine small enough
 *    that a share of it is under the default is a machine where raising nothing
 *    is the right answer; asking for less would turn a build that worked into
 *    one that does not.
 * 3. **A share of the machine, divided by the readers running at once.** A
 *    limit is a ceiling rather than a reservation, but several readers can reach
 *    their ceilings together, and a build that drives the machine into swap has
 *    not helped anyone.
 *
 * `MOST_MB` is the one number here with a measurement behind it rather than a
 * judgement, and it is deliberately not generous: a repository that does not fit
 * under it fails with a sentence saying so and naming this flag, which is a
 * better outcome than a machine that pages for half an hour. Raising it is one
 * flag away, and the message says which one.
 */

/** A share of the machine, not all of it: the rest is the file system cache and everybody else. */
const SHARE_OF_MACHINE = 0.75;

/**
 * The most this will ask for on its own.
 *
 * Measured, on 2026-09-27, against the largest of the eight coverage targets:
 * `payload` with dependencies installed reads in 120 s under a 12288 MB limit
 * and runs out of heap under 8192 MB. Beyond this the tool says so and points at
 * `--heap`, because a limit larger than this is a decision about the machine and
 * belongs to whoever owns it.
 */
export const MOST_MB = 12288;

const MB = 1024 * 1024;

export interface HeapInputs {
  /** Physical memory of the machine, in bytes. */
  totalBytes: number;
  /** The heap limit this process is running under, in bytes. */
  ownLimitBytes: number;
  /** How many repositories are read at the same time. */
  readers: number;
  /** A limit the caller already asked for, in megabytes, if they did. */
  asked?: number | undefined;
  /** `NODE_OPTIONS` and this process's own arguments, as the environment has them. */
  alreadySet?: boolean | undefined;
}

/** Whether a limit has already been asked for somewhere the child will inherit it. */
export const heapAlreadyAsked = (
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.execArgv,
): boolean => {
  const pattern = /--max[-_]old[-_]space[-_]size/;
  return pattern.test(env['NODE_OPTIONS'] ?? '') || argv.some((arg) => pattern.test(arg));
};

/**
 * The heap limit for one reader, in megabytes, or nothing to leave it alone.
 *
 * Nothing rather than a number wherever the answer is "what the runtime already
 * decided", so that the flag appears on a command line only when it changes
 * something.
 */
export const heapMbFor = (inputs: HeapInputs): number | undefined => {
  if (inputs.asked !== undefined) return inputs.asked;
  if (inputs.alreadySet === true) return undefined;
  const readers = Math.max(inputs.readers, 1);
  const share = Math.floor((inputs.totalBytes * SHARE_OF_MACHINE) / readers / MB);
  const own = Math.floor(inputs.ownLimitBytes / MB);
  const wanted = Math.min(Math.max(share, own), MOST_MB);
  return wanted <= own ? undefined : wanted;
};

/** The same question asked of this machine. */
export const heapForReaders = (readers: number, asked?: number | undefined): number | undefined =>
  heapMbFor({
    totalBytes: totalmem(),
    ownLimitBytes: getHeapStatistics().heap_size_limit,
    readers,
    asked,
    alreadySet: heapAlreadyAsked(),
  });

/** Arguments that give a child process that limit, or none when there is nothing to change. */
export const heapArgs = (heapMb: number | undefined): string[] =>
  heapMb === undefined ? [] : [`--max-old-space-size=${heapMb}`];
