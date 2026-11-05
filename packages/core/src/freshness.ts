/**
 * Whether the graph is older than the code it describes (P230).
 *
 * The server reopens a database a build replaced, and `build --watch` keeps
 * one current while it runs; neither says anything when the graph is behind.
 * An assistant edits a method and asks `impact` on it, and the answer is from
 * before the edit; a person checks out another branch and asks `flow`, and the
 * answer describes the one they left. Nothing in either answer looks wrong.
 *
 * So a build writes, beside the database, what it read: each service's
 * checkout (the commit and branch its directory was on, and whether its files
 * differed from that commit) and every file's size, modification time and
 * hash. An answer is checked against the files it cites, not against the
 * commit: a commit changes no file on disk, and the edit before it already
 * did. A file whose time moved and whose size did not is hashed before it is
 * called changed, so a `touch` is not a change.
 *
 * Kept out of the graph on purpose, like the build cache: a commit and a clock
 * inside the hashed graph would move every snapshot on every commit (R82).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/** The file beside `graph.db`. */
export const FRESHNESS_FILE = 'freshness.json';

export const FRESHNESS_FORMAT_VERSION = 1;

/** Most files of one answer checked: an answer is bounded, and so is the check. */
export const MAX_CITED_FILES = 200;

/** A file as it was read: size, modification time, content hash. */
const stampSchema = z.tuple([z.number().int().min(0), z.number(), z.string()]);

const checkoutSchema = z.object({
  /** HEAD's commit, or null outside a checkout. */
  commit: z.string().nullable(),
  /** The branch HEAD was on, or null when detached or outside a checkout. */
  branch: z.string().nullable(),
  /** Whether a tracked file under the service's directory differed from HEAD when it was read. */
  dirty: z.boolean(),
});

const serviceSchema = checkoutSchema.extend({
  /** The service's directory, absolute. */
  dir: z.string(),
  /** Repository-relative POSIX path to how it was read. */
  files: z.record(z.string(), stampSchema),
});

export const freshnessSchema = z.object({
  freshnessFormatVersion: z.literal(FRESHNESS_FORMAT_VERSION),
  builtAt: z.string(),
  services: z.record(z.string(), serviceSchema),
});

export type Checkout = z.infer<typeof checkoutSchema>;
export type FreshnessService = z.infer<typeof serviceSchema>;
export type Freshness = z.infer<typeof freshnessSchema>;

/** The freshness file beside a database. */
export const freshnessPathFor = (dbPath: string): string => join(dirname(dbPath), FRESHNESS_FILE);

/** The freshness a build wrote beside a database, or undefined when there is none or it cannot be read. */
export const readFreshness = (dbPath: string): Freshness | undefined => {
  try {
    const parsed = freshnessSchema.safeParse(JSON.parse(readFileSync(freshnessPathFor(dbPath), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** The hash the build cache gives a file's text (`hashText` in the command line's cache). */
export const contentHash = (text: string): string => `sha1:${createHash('sha1').update(text).digest('hex')}`;

const hashOfFile = (path: string): string => {
  try {
    return contentHash(readFileSync(path, 'utf8'));
  } catch {
    return contentHash('');
  }
};

/** One file an answer names: the service it is in and its repository-relative path. */
export interface CitedFile {
  service: string;
  file: string;
}

/** `src/orders.ts:12` or `src/orders.ts` → the path. */
const fileOfLoc = (loc: string): string => loc.replace(/:\d+(?::\d+)?$/, '');

/**
 * `orders#src/orders.service.ts:OrdersService.create`,
 * `db_query:orders#src/orders.service.ts:41:23` → the service and the file. An
 * id with no `#`, or nothing that looks like a path after it, names no file.
 */
const fileOfId = (id: string): CitedFile | undefined => {
  const match = /^(?:[a-z_]+:)?([^#:\s]+)#([^:#\s]+\.[A-Za-z0-9]+)(?::|$)/.exec(id);
  return match === null ? undefined : { service: match[1] as string, file: match[2] as string };
};

/**
 * The files an answer cites, at most `limit`: every row that says its service
 * and `loc`, and every id that names a file. Read off the answer as it goes
 * out, so every tool and command is checked the same way without each one
 * remembering to.
 */
export const citedFiles = (answer: unknown, limit = MAX_CITED_FILES): CitedFile[] => {
  const found = new Map<string, CitedFile>();
  const add = (cited: CitedFile | undefined): void => {
    if (cited === undefined || found.size >= limit) return;
    found.set(`${cited.service}\n${cited.file}`, cited);
  };
  const visit = (value: unknown, depth: number): void => {
    if (found.size >= limit || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record['service'] === 'string' && typeof record['loc'] === 'string') {
      add({ service: record['service'], file: fileOfLoc(record['loc']) });
    }
    if (typeof record['id'] === 'string') add(fileOfId(record['id']));
    for (const [key, item] of Object.entries(record)) if (key !== 'loc') visit(item, depth + 1);
  };
  visit(answer, 0);
  return [...found.values()];
};

/** What `stale` says on an answer: how many of the files it cites changed since the build, the first of them. */
export interface Stale {
  files: number;
  of: number;
  first: string;
  since: string;
}

/**
 * How many of `cited` changed since the build, against the stamps the build
 * wrote; undefined when none did, or when nothing can say (no freshness file,
 * no cited file it knows). A file the build read and that is gone counts as
 * changed. A file the build has no stamp for is not counted: nothing says what
 * it was.
 */
export const staleOf = (freshness: Freshness | undefined, cited: readonly CitedFile[]): Stale | undefined => {
  if (freshness === undefined || cited.length === 0) return undefined;
  let of = 0;
  const changed: string[] = [];
  for (const { service, file } of cited) {
    const known = freshness.services[service];
    const stamp = known?.files[file];
    // A service not checked out here (a pulled graph, P236) is not stale: nothing here says what it is now.
    if (known === undefined || stamp === undefined || !existsSync(known.dir)) continue;
    of += 1;
    const path = isAbsolute(file) ? file : resolve(known.dir, file);
    const [size, mtimeMs, hash] = stamp;
    let now: { size: number; mtimeMs: number } | undefined;
    try {
      const stat = statSync(path);
      now = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      now = undefined;
    }
    const moved =
      now === undefined || now.size !== size || (now.mtimeMs !== mtimeMs && hashOfFile(path) !== hash);
    if (moved) changed.push(`${service}/${file}`);
  }
  if (changed.length === 0) return undefined;
  return { files: changed.length, of, first: changed.sort()[0] as string, since: freshness.builtAt };
};

/** Where a directory's checkout keeps its refs: its git directory and the common one. */
interface GitDirs {
  gitDir: string;
  commonDir: string;
}

/** The checkout a directory is in: its `.git` directory, or the one a worktree's `.git` file names. */
const gitDirsOf = (dir: string): GitDirs | undefined => {
  let at = resolve(dir);
  for (;;) {
    const dot = join(at, '.git');
    if (existsSync(dot)) {
      let gitDir = dot;
      try {
        if (!statSync(dot).isDirectory()) {
          const named = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(dot, 'utf8'))?.[1];
          if (named === undefined) return undefined;
          gitDir = resolve(at, named.trim());
        }
      } catch {
        return undefined;
      }
      let commonDir = gitDir;
      try {
        commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
      } catch {
        // No `commondir`: the git directory is its own.
      }
      return { gitDir, commonDir };
    }
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
};

/** A ref's commit, from its loose file or from `packed-refs`. */
const refCommit = (dirs: GitDirs, ref: string): string | null => {
  for (const base of [dirs.gitDir, dirs.commonDir]) {
    try {
      const sha = readFileSync(join(base, ref), 'utf8').trim();
      if (/^[0-9a-f]{40,64}$/.test(sha)) return sha;
    } catch {
      // Not loose here; try the next place.
    }
  }
  try {
    for (const line of readFileSync(join(dirs.commonDir, 'packed-refs'), 'utf8').split('\n')) {
      const [sha, name] = line.trim().split(' ');
      if (name === ref && sha !== undefined && /^[0-9a-f]{40,64}$/.test(sha)) return sha;
    }
  } catch {
    // No packed refs.
  }
  return null;
};

/**
 * The commit and branch a directory's checkout is on, read off its files
 * rather than by starting git: HEAD, the ref it names (loose or packed), a
 * worktree's own HEAD. Null where it is not a checkout or the files do not
 * say. Cheap enough to ask on every poll.
 */
export const headOf = (dir: string): { commit: string | null; branch: string | null } => {
  const dirs = gitDirsOf(dir);
  if (dirs === undefined) return { commit: null, branch: null };
  let head: string;
  try {
    head = readFileSync(join(dirs.gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return { commit: null, branch: null };
  }
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (ref === undefined) return { commit: /^[0-9a-f]{40,64}$/.test(head) ? head : null, branch: null };
  return { commit: refCommit(dirs, ref), branch: ref.replace(/^refs\/heads\//, '') };
};

/** One service whose checkout is not where the build found it. */
export interface CheckoutMoved {
  service: string;
  built: { commit: string | null; branch: string | null };
  now: { commit: string | null; branch: string | null };
}

const short = (side: { commit: string | null; branch: string | null }): string =>
  `${side.branch ?? 'detached'}@${side.commit === null ? 'unknown' : side.commit.slice(0, 7)}`;

/** `web: built on main@4f1c2a9, now feature-x@91be03d`. */
export const checkoutLine = (moved: CheckoutMoved): string => `${moved.service}: built on ${short(moved.built)}, now ${short(moved.now)}`;

/**
 * The services whose checkout moved since the build: another commit or
 * another branch. A service outside a checkout never moved, as far as anything
 * here can say. `head` is asked once per service directory.
 */
export const checkoutsMoved = (
  freshness: Freshness | undefined,
  head: (dir: string) => { commit: string | null; branch: string | null } = headOf,
): CheckoutMoved[] => {
  if (freshness === undefined) return [];
  const asked = new Map<string, { commit: string | null; branch: string | null }>();
  const moved: CheckoutMoved[] = [];
  for (const [service, built] of Object.entries(freshness.services).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (built.commit === null) continue;
    let now = asked.get(built.dir);
    if (now === undefined) {
      now = head(built.dir);
      asked.set(built.dir, now);
    }
    // Not a checkout here, as a pulled graph's other services are (P236): nothing to compare.
    if (now.commit === null && !existsSync(built.dir)) continue;
    if (now.commit !== built.commit || now.branch !== built.branch) {
      moved.push({ service, built: { commit: built.commit, branch: built.branch }, now });
    }
  }
  return moved;
};
