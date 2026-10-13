import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Where a build keeps what it wrote about each service, under its own output.
 *
 * A build used to write each service's graph and file hashes into the service's
 * repository, at `<repo>/.flowatlas/`. That is a write into a directory the
 * build was only asked to read, and two projects whose configurations name the
 * same repository shared one set of those files and overwrote each other's
 * (R166). Everything a build writes now lives under the output directory the
 * configuration names, and a service's own files under
 * `<output>/services/<directory>/`.
 */
export const SERVICES_DIRECTORY = 'services';

/**
 * Characters a service name keeps as they are in its directory name.
 *
 * Lower case only. On the file systems most people run this on, `Api` and `api`
 * are one directory, so two services named that way would share their files;
 * an upper-case letter is written as its code instead, and the two stay apart.
 */
const KEPT = /^[a-z0-9._-]$/;

/** Names a directory cannot have on Windows, whatever its extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * Longer than this and the name is shortened, with a hash of the whole of it.
 *
 * Well under the 255 bytes a directory name may have, because a name written as
 * codes is up to nine times its own length and the directory is one segment of
 * a path that has a limit of its own.
 */
const LONGEST = 120;
const KEPT_OF_LONG = 96;

const escape = (char: string): string =>
  [...Buffer.from(char, 'utf8')]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');

/**
 * The one directory a service's files go in, named after the service.
 *
 * A service name is anything the configuration accepts, and a directory name is
 * not: `@scope/orders` would nest, `..` would climb out, `Orders` and `orders`
 * are one directory on a case-insensitive disk. So the name is written the way
 * a URL writes what it cannot hold, as `%` and two hex digits per byte, for
 * everything but lower-case letters, digits, `-`, `_` and an inner `.`. A `%`
 * is itself written as `%25`, which is what makes this one-to-one: every
 * directory name decodes to exactly one service name, so two services never
 * share a directory.
 *
 * Three refinements, each keeping that property. A leading or trailing `.` is
 * written as a code, so no service is a hidden directory, `.` or `..`, and none
 * ends in a dot that Windows would drop. A name Windows reserves for a device
 * has its first letter written as a code. A name that would come out longer
 * than {@link LONGEST} keeps its first part and ends in `~` and a hash of the
 * whole name; `~` is never kept as itself anywhere else, so a shortened name
 * cannot equal one that was not, and two shortened names are equal only if
 * their hashes are.
 */
export const serviceDirectoryName = (name: string): string => {
  const chars = [...name];
  const reserved = RESERVED.test(name.split('.')[0] ?? '');
  const written = chars
    .map((char, index) => {
      const edge = index === 0 || index === chars.length - 1;
      if (char === '.' && edge) return escape(char);
      if (index === 0 && reserved) return escape(char);
      return KEPT.test(char) ? char : escape(char);
    })
    .join('');
  if (written.length <= LONGEST) return written;
  // Cut on a whole character, never inside one `%XX`.
  let kept = '';
  for (const piece of written.match(/%[0-9A-F]{2}|./g) ?? []) {
    if (kept.length + piece.length > KEPT_OF_LONG) break;
    kept += piece;
  }
  const hash = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 16);
  return `${kept}~${hash}`;
};

/** The directory a build writes one service's graph and file hashes into. */
export const serviceOutputDir = (outputDir: string, name: string): string =>
  join(outputDir, SERVICES_DIRECTORY, serviceDirectoryName(name));
