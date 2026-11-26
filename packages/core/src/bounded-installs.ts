import type { FileSystemHost } from 'ts-morph';
import { installsHiddenAbove } from './installs-above.js';
import { realFileSystem } from './stand-ins.js';

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
 * always has - said in a row where a tsconfig names one (P357,
 * `tsconfig-reach.ts`).
 */
export const boundedInstalls = (ceiling: string, base: FileSystemHost = realFileSystem()): FileSystemHost => {
  const hidden = installsHiddenAbove(ceiling, (path) => base.realpathSync(path));
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
