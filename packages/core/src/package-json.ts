import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The manifest file, as a shape and a reader.
 *
 * Nothing here answers a question about a manifest — not what a package may
 * import, not which directories belong together. It is the file format alone,
 * which is why it sits below both: the workspace discoverer needs to read a
 * manifest to find out whether a directory declares members, and the dependency
 * reader needs the discoverer to find out which manifests govern a directory.
 * With the format in its own module neither has to reach through the other, and
 * there is one reader of this file rather than one per question asked of it.
 */

/** The subset of a `package.json` this tool reads. */
export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Reads a directory's own `package.json`, or returns undefined when there is
 * none or it is not valid JSON. Total on purpose: reading a repository must
 * never crash on a tree with an odd layout.
 */
export const readPackageJson = (dir: string): PackageJson | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : undefined;
  } catch {
    return undefined;
  }
};
