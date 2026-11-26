import { ts } from 'ts-morph';
import { toPosixPath } from './ids.js';
import { mayClimbTo } from './upward-walk.js';

/**
 * Whether a path is under an install whose directory lies above `ceiling`
 * (P340): the outermost `node_modules` the path is under decides, since one
 * inside the repository may hold another and both are the repository's. A
 * directory and the ceiling may be spelled through different links to the
 * same place - a temporary directory under `/var` that the compiler reaches
 * as `/private/var` - so each is also compared by the path it really is.
 */
export const installsHiddenAbove = (ceiling: string, realpath: (path: string) => string): ((path: string) => boolean) => {
  const allowed = new Map<string, boolean>();
  const realOf = (path: string): string | undefined => {
    try {
      return toPosixPath(realpath(path));
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
  return (path) => {
    const posixPath = toPosixPath(path);
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
};

/** The disk's answer to what a path really is, the path itself where it cannot say. */
const realOnDisk = (path: string): string => (ts.sys.realpath === undefined ? path : ts.sys.realpath(path));

/**
 * The host a tsconfig is parsed with outside the compiler's own project
 * (P357): the disk, with every install above `ceiling` hidden, so that an
 * `extends` naming a package resolves as the project's compiler resolves it,
 * from an install inside the bound alone. With no ceiling, the disk as it is.
 */
export const boundedConfigHost = (ceiling: string | undefined): ts.ParseConfigHost & ts.ModuleResolutionHost => {
  const hidden = ceiling === undefined ? (): boolean => false : installsHiddenAbove(ceiling, realOnDisk);
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (path) => !hidden(path) && ts.sys.fileExists(path),
    readFile: (path) => (hidden(path) ? undefined : ts.sys.readFile(path)),
    directoryExists: (path) => !hidden(path) && ts.sys.directoryExists(path),
    realpath: realOnDisk,
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    readDirectory: () => [],
  };
};
