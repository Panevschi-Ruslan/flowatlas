import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { expandGlob, isGlob, NEVER_WALKED, SHAPE_BODY_BYTES, toPosixPath } from '@flowatlas/core';
import { cannotRun } from '../exit.js';
import type { Attached } from './readers/index.js';
import { isZip, ZipError, zipEntries } from './zip.js';

/**
 * What `observe <path...>` reads (P205): each path named as it is, each glob
 * as the files it matches (quoted, so a shell that does not expand `**`
 * leaves it to flowatlas), and each directory as the HAR files under it - what
 * a test run leaves behind: `*.har`, `*.har.gz`, and the `.zip` archives
 * Playwright writes for `recordHar` with a `.zip` path. Everything else in a
 * directory (videos, screenshots, traces, the bodies a HAR attached, other
 * trace formats) is left alone and counted in a note; a trace file of another
 * format is named on its own, or with a glob.
 */
export interface NamedTraceFiles {
  files: string[];
  notes: string[];
}

const HAR_FILE = /\.har(?:\.gz)?$/i;
const ZIP_FILE = /\.zip$/i;

/** The largest HAR read out of an archive. */
const HAR_IN_ZIP_BYTES = 512 * 1024 * 1024;

/** Whether a `.zip` holds a HAR: the archive Playwright writes, `har.har` and its bodies. */
const zipHoldsHar = (file: string): boolean => {
  try {
    const bytes = readFileSync(file);
    return isZip(bytes) && zipEntries(bytes).some((entry) => HAR_FILE.test(entry.name));
  } catch {
    return false;
  }
};

/** Every file under `dir`, but in `node_modules` and `.git`, sorted. */
const filesUnder = (dir: string): string[] => {
  const found: string[] = [];
  const walk = (at: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!NEVER_WALKED.has(entry.name)) walk(path);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found.sort();
};

/** A path to print: relative to where flowatlas runs when it was named that way, POSIX. */
const shown = (cwd: string, written: string, path: string): string => toPosixPath(isAbsolute(written) ? path : relative(cwd, path) || '.');

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const traceFilesNamed = (paths: readonly string[], cwd: string = process.cwd()): NamedTraceFiles => {
  const files: string[] = [];
  const notes: string[] = [];
  for (const written of paths) {
    if (isGlob(written)) {
      const matched = expandGlob(cwd, written);
      if (matched.length === 0) throw cannotRun(`${written} matches no file`);
      files.push(...matched.map((path) => shown(cwd, written, path)));
      continue;
    }
    const at = resolve(cwd, written);
    if (!isDirectory(at)) {
      files.push(written);
      continue;
    }
    const under = filesUnder(at);
    const hars = under.filter((path) => HAR_FILE.test(path) || (ZIP_FILE.test(path) && zipHoldsHar(path)));
    if (hars.length === 0) {
      throw cannotRun(
        `${written} holds no HAR file: a directory is read for its .har, .har.gz and Playwright .zip files; name a trace file of another format on its own`,
      );
    }
    files.push(...hars.map((path) => shown(cwd, written, path)));
    const left = under.length - hars.length;
    if (left > 0) {
      notes.push(
        `left alone in ${toPosixPath(written)}: ${left} file${left === 1 ? '' : 's'} that ${left === 1 ? 'is' : 'are'} not HAR (a directory is read for its HAR files; name other trace files on their own)`,
      );
    }
  }
  return { files, notes };
};

/** A name a HAR may give an attached body: a file's name, never a path. */
const ATTACHED_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Where a HAR's attached bodies are (Playwright's `content: 'attach'`, P205):
 * files beside it, named by its entries. Only a plain file name is looked
 * for, in the HAR's own directory, and only up to the size a body is read to.
 */
export const attachedBeside = (harFile: string) => (name: string): Attached => {
  if (!ATTACHED_NAME.test(name) || basename(name) !== name) return { why: 'attached under a name that is not a file beside the HAR' };
  const path = join(dirname(harFile), name);
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { why: 'attached in a file that is not beside the HAR' };
    size = stat.size;
  } catch {
    return { why: 'attached in a file that is not beside the HAR' };
  }
  if (size > SHAPE_BODY_BYTES) return { why: 'over 1 MB' };
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch {
    return { why: 'attached in a file that cannot be read' };
  }
};

/**
 * The HARs a Playwright archive holds, parsed, and its attached bodies by
 * name. Refuses an archive with no HAR in it, or one that cannot be read.
 */
export const harsInZip = (file: string, bytes: Buffer): { documents: unknown[]; attachment: (name: string) => Attached } => {
  let entries;
  try {
    entries = zipEntries(bytes);
  } catch (cause) {
    throw cannotRun(`${file} is a zip archive that cannot be read: ${cause instanceof ZipError ? cause.message : String(cause)}`);
  }
  const hars = entries.filter((entry) => HAR_FILE.test(entry.name) && !entry.name.toLowerCase().endsWith('.gz'));
  if (hars.length === 0) throw cannotRun(`${file} is a zip archive with no HAR in it`);
  const documents = hars.map((entry) => {
    try {
      return JSON.parse(entry.read(HAR_IN_ZIP_BYTES).toString('utf8')) as unknown;
    } catch (cause) {
      throw cannotRun(`${file}: ${entry.name} ${cause instanceof ZipError ? `cannot be read (${cause.message})` : 'is not JSON'}`);
    }
  });
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const attachment = (name: string): Attached => {
    const entry = ATTACHED_NAME.test(name) ? byName.get(name) : undefined;
    if (entry === undefined) return { why: 'attached in a file the archive does not hold' };
    if (entry.size > SHAPE_BODY_BYTES) return { why: 'over 1 MB' };
    try {
      return { text: entry.read(SHAPE_BODY_BYTES).toString('utf8') };
    } catch {
      return { why: 'attached in a file that cannot be read' };
    }
  };
  return { documents, attachment };
};
