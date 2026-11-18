import type { FileSystemHost } from 'ts-morph';
import { toPosixPath } from './ids.js';
import { realFileSystem } from './stand-ins.js';
import { mayClimbTo } from './upward-walk.js';

/**
 * The file system the compiler resolves a repository's imports through, with
 * every install above the repository hidden (P340).
 *
 * The compiler finds a package the way Node does: in `node_modules` beside the
 * importing file and in every directory above it, up to the root of the file
 * system, and it takes the types of `node_modules/@types` from each of those
 * directories too. Followed past the repository, that reads a package
 * installed in the home directory or in an unrelated checkout above the clone
 * and lets its types into the graph. Here a path under a `node_modules` whose
 * directory lies above `ceiling` does not exist; everything else, an install
 * inside the repository among it, is the base file system's answer unchanged.
 *
 * Only `node_modules` is hidden: a file above the ceiling a repository names
 * by a relative path is its own statement, and the compiler reads it as it
 * always has.
 */
export const boundedInstalls = (ceiling: string, base: FileSystemHost = realFileSystem()): FileSystemHost => {
  const allowed = new Map<string, boolean>();
  // A directory and the ceiling may be spelled through different links to the
  // same place - a temporary directory under `/var` that the compiler reaches
  // as `/private/var` - so each is also compared by the path it really is.
  const realOf = (path: string): string | undefined => {
    try {
      return toPosixPath(base.realpathSync(path));
    } catch {
      return undefined;
    }
  };
  const ceilings = [...new Set([ceiling, realOf(ceiling)].filter((path): path is string => path !== undefined))];
  const within = (dir: string): boolean => {
    if (ceilings.some((top) => mayClimbTo(dir, top))) return true;
    const real = realOf(dir);
    return real !== undefined && real !== dir && ceilings.some((top) => mayClimbTo(real, top));
  };
  const hidden = (path: string): boolean => {
    const posixPath = toPosixPath(path);
    // The outermost install a path is under decides: one inside the
    // repository may hold another, and both are the repository's.
    let at = posixPath.indexOf('/node_modules');
    while (at >= 0) {
      const after = posixPath.charAt(at + '/node_modules'.length);
      if (after === '' || after === '/') break;
      at = posixPath.indexOf('/node_modules', at + 1);
    }
    if (at < 0) return false;
    const dir = at === 0 ? '/' : posixPath.slice(0, at);
    let may = allowed.get(dir);
    if (may === undefined) {
      may = within(dir);
      allowed.set(dir, may);
    }
    return !may;
  };
  const absent = (path: string): Error => Object.assign(new Error(`ENOENT: ${path} is above the repository (P340)`), { code: 'ENOENT' });
  return {
    isCaseSensitive: () => base.isCaseSensitive(),
    delete: (path) => base.delete(path),
    deleteSync: (path) => base.deleteSync(path),
    readDirSync: (dirPath) => {
      if (hidden(dirPath)) throw absent(dirPath);
      return base.readDirSync(dirPath);
    },
    readFile: async (filePath, encoding) => {
      if (hidden(filePath)) throw absent(filePath);
      return base.readFile(filePath, encoding);
    },
    readFileSync: (filePath, encoding) => {
      if (hidden(filePath)) throw absent(filePath);
      return base.readFileSync(filePath, encoding);
    },
    writeFile: (filePath, text) => base.writeFile(filePath, text),
    writeFileSync: (filePath, text) => base.writeFileSync(filePath, text),
    mkdir: (dirPath) => base.mkdir(dirPath),
    mkdirSync: (dirPath) => base.mkdirSync(dirPath),
    move: (from, to) => base.move(from, to),
    moveSync: (from, to) => base.moveSync(from, to),
    copy: (from, to) => base.copy(from, to),
    copySync: (from, to) => base.copySync(from, to),
    fileExists: async (filePath) => !hidden(filePath) && base.fileExists(filePath),
    fileExistsSync: (filePath) => !hidden(filePath) && base.fileExistsSync(filePath),
    directoryExists: async (dirPath) => !hidden(dirPath) && base.directoryExists(dirPath),
    directoryExistsSync: (dirPath) => !hidden(dirPath) && base.directoryExistsSync(dirPath),
    realpathSync: (path) => base.realpathSync(path),
    getCurrentDirectory: () => base.getCurrentDirectory(),
    glob: (patterns) => base.glob(patterns),
    globSync: (patterns) => base.globSync(patterns),
  };
};
