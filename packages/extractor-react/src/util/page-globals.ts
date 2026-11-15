import { basename, isAbsolute, join } from 'node:path';
import type { FileSystemHost, SourceFile } from 'ts-morph';

/**
 * The installed clients a plain page loads by a script tag (P310).
 *
 * A page without a bundler loads its client the way the client's own
 * documentation shows - `<script src="https://cdn.example.test/npm/axios/dist/axios.min.js">`,
 * or a copy kept beside the page's own scripts - and the client is then the
 * global its browser build leaves on `window`: `axios.get(url)` with no import
 * and nothing installed. The name is the client's where a page of the
 * repository loads a script the client's package names, or where the script
 * calling it declares the global for its linter (`/* global axios *\/`); a
 * name the repository declares is its own, whatever it is called.
 */

/** The directories a page is never looked for in: installed packages, and a build's own copies. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** How many pages are read at most, so a repository of generated documentation is not read whole. */
const PAGE_LIMIT = 200;

/** How many directories are entered at most. */
const DIRECTORY_LIMIT = 5000;

/**
 * Every page of a repository: its `.html` files, wherever they are kept.
 * Read through the project's own file system, which is the disk for a
 * repository and memory for a project made up in a test.
 */
const pagesOf = (fs: FileSystemHost, repoDir: string): string[] => {
  const found: string[] = [];
  let entered = 0;
  const walk = (dir: string): void => {
    if (found.length >= PAGE_LIMIT || entered >= DIRECTORY_LIMIT) return;
    entered += 1;
    let entries;
    try {
      entries = fs.readDirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= PAGE_LIMIT) return;
      // One host names an entry by its path, another by its name alone.
      const path = isAbsolute(entry.name) ? entry.name : join(dir, entry.name);
      const name = basename(path);
      if (entry.isDirectory) {
        if (!SKIPPED.has(name) && !name.startsWith('.')) walk(path);
      } else if (entry.isFile && /\.html?$/i.test(name)) found.push(path);
    }
  };
  walk(repoDir);
  return found;
};

/** Whether a script's address names a package's browser build: a folder of the package's name, or a file of it. */
export const namesPackage = (src: string, module: string): boolean => {
  const parts = src.replace(/[?#].*$/, '').split(/[\\/]/).filter((part) => part !== '');
  const file = parts.at(-1) ?? '';
  const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^${escaped}(?:[.-]\\d[\\w.-]*)?(?:\\.min)?\\.js$`, 'i').test(file)) return true;
  return parts.slice(0, -1).some((part) => part === module || part.startsWith(`${module}@`));
};

/** The address of every `<script src>` a page writes. */
const scriptSources = (html: string): string[] =>
  [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');

/** The packages a page of the repository loads by a script tag, of those asked about (`modules`). */
export const pageLoadedPackages = (fs: FileSystemHost, repoDir: string, modules: readonly string[]): ReadonlySet<string> => {
  const loaded = new Set<string>();
  if (modules.length === 0) return loaded;
  for (const page of pagesOf(fs, repoDir)) {
    let html: string;
    try {
      html = fs.readFileSync(page, 'utf8');
    } catch {
      continue;
    }
    for (const src of scriptSources(html)) for (const module of modules) if (namesPackage(src, module)) loaded.add(module);
  }
  return loaded;
};

const declaredIn = new WeakMap<SourceFile, ReadonlySet<string>>();

/** The globals a script declares for its linter: `/* global axios, Vue: readonly *\/`. */
export const declaredGlobals = (file: SourceFile): ReadonlySet<string> => {
  const known = declaredIn.get(file);
  if (known !== undefined) return known;
  const names = new Set<string>();
  for (const match of file.getFullText().matchAll(/\/\*\s*globals?\s+([^*]*)\*\//g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/[\s:]/)[0];
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  declaredIn.set(file, names);
  return names;
};
