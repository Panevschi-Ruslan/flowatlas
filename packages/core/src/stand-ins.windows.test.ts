import { posix, win32 } from 'node:path';
import type { FileSystemHost, RuntimeDirEntry } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { normalizeFilePath, toPosixPath } from './ids.js';
import type { PackageSource } from './package-index.js';
import {
  isWithinDir,
  mountedFileSystem,
  mountOfPath,
  mountTableOf,
  realPathOf,
  virtualRootOf,
  type Mount,
} from './stand-ins.js';

/**
 * Mounting with Windows paths, on any OS (P83, D4).
 *
 * The path logic is pure given its inputs, so a Windows-shaped root and the
 * paths the compiler asks with are fed in here as strings, built with
 * `path.win32` where a path module would be involved, and every answer must be
 * the one the POSIX case gives. A real Windows runner is a bonus, not the proof.
 */

const source = (name: string, dir: string): PackageSource => ({ name, dir, manifest: { name }, origin: 'service' });

/** One layout, spelled two ways: the service, the package it mounts, and a file of the package. */
const LAYOUTS = {
  posix: {
    root: posix.resolve('/work/shop/services/orders'),
    dir: '/work/shop/packages/money',
    asked: ['/work/shop/services/orders/node_modules/@acme/money/src/index.ts'],
    real: '/work/shop/packages/money/src/index.ts',
  },
  windows: {
    root: win32.resolve('C:\\work\\shop\\services\\orders'),
    dir: win32.join('C:\\work\\shop', 'packages', 'money'),
    // The compiler asks with forward slashes; a caller of the OS's own path
    // module would hand backslashes. Both are the same file.
    asked: [
      'C:/work/shop/services/orders/node_modules/@acme/money/src/index.ts',
      'C:\\work\\shop\\services\\orders\\node_modules\\@acme\\money\\src\\index.ts',
      'c:/work/shop/services/orders/node_modules/@acme/money/src/index.ts',
    ],
    real: 'C:/work/shop/packages/money/src/index.ts',
  },
} as const;

const mountIn = (layout: (typeof LAYOUTS)[keyof typeof LAYOUTS]): Mount => ({
  source: source('@acme/money', layout.dir),
  virtual: virtualRootOf(layout.root, '@acme/money'),
});

/** A file system holding one file and one directory listing, which says what it was asked. */
const fakeDisk = (files: Record<string, string>, listings: Record<string, string[]>) => {
  const asked: string[] = [];
  const key = (path: string): string => toPosixPath(path);
  const host = {
    isCaseSensitive: () => true,
    readFileSync: (path: string) => {
      asked.push(path);
      const text = files[key(path)];
      if (text === undefined) throw new Error(`not found: ${path}`);
      return text;
    },
    fileExistsSync: (path: string) => {
      asked.push(path);
      return files[key(path)] !== undefined;
    },
    directoryExistsSync: (path: string) => {
      asked.push(path);
      return listings[key(path)] !== undefined;
    },
    readDirSync: (path: string): RuntimeDirEntry[] => {
      asked.push(path);
      // Named as ts-morph's own host names them: the directory joined with
      // the entry, with forward slashes.
      return (listings[key(path)] ?? []).map((name) => ({
        name: `${key(path)}/${name}`,
        isFile: name.includes('.'),
        isDirectory: !name.includes('.'),
        isSymlink: false,
      }));
    },
    realpathSync: (path: string) => path,
    getCurrentDirectory: () => '/',
  } as unknown as FileSystemHost;
  return { host, asked };
};

describe('a mount on Windows (P83)', () => {
  it('is held at the forward-slash path the compiler asks for', () => {
    expect(mountIn(LAYOUTS.windows).virtual).toBe('C:/work/shop/services/orders/node_modules/@acme/money');
    expect(mountIn(LAYOUTS.posix).virtual).toBe('/work/shop/services/orders/node_modules/@acme/money');
    expect(() => mountTableOf([mountIn(LAYOUTS.windows)])).not.toThrow();
  });

  it('is found for a path spelled either way, as the POSIX one is', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const mount = mountIn(layout);
      const table = mountTableOf([mount]);
      for (const path of layout.asked) {
        expect(mountOfPath(table, path)).toBe(mount);
        expect(toPosixPath(realPathOf(table, path) ?? '')).toBe(layout.real);
      }
      expect(mountOfPath(table, `${toPosixPath(layout.root)}/src/main.ts`)).toBeUndefined();
    }
  });

  it('tells a directory inside another apart from one that only begins like it, on either OS', () => {
    expect(isWithinDir('C:\\work\\shop\\packages\\money\\src', 'C:/work/shop/packages/money')).toBe(true);
    expect(isWithinDir('c:/work/shop/packages/money', 'C:\\work\\shop\\packages\\money\\')).toBe(true);
    expect(isWithinDir('C:\\work\\shop\\packages\\money-extra', 'C:\\work\\shop\\packages\\money')).toBe(false);
    expect(isWithinDir('D:\\work\\shop\\packages\\money', 'C:\\work\\shop\\packages\\money')).toBe(false);
    expect(isWithinDir('/work/shop/packages/money/src', '/work/shop/packages/money')).toBe(true);
    expect(isWithinDir('/work/shop/packages/money-extra', '/work/shop/packages/money')).toBe(false);
  });

  it('reads through to the source, lists it at its virtual path and keeps the virtual name, as the POSIX one does', () => {
    const answers = Object.values(LAYOUTS).map((layout) => {
      const real = layout.real;
      const dir = toPosixPath(layout.dir);
      const { host, asked } = fakeDisk({ [real]: 'export const money = 1;\n' }, { [`${dir}/src`]: ['index.ts'] });
      const fs = mountedFileSystem([mountIn(layout)], host);
      const root = toPosixPath(layout.root);
      const answer = {
        texts: layout.asked.map((path) => fs.readFileSync(path)),
        exists: layout.asked.map((path) => fs.fileExistsSync(path)),
        scope: fs.directoryExistsSync(`${root}/node_modules/@acme`),
        listed: fs.readDirSync(`${root}/node_modules/@acme/money/src`).map((entry) => entry.name.slice(root.length)),
        above: fs.readDirSync(`${root}/node_modules/@acme`).map((entry) => toPosixPath(entry.name).slice(root.length)),
        kept: fs.realpathSync(layout.asked[0]),
        // Every file read went to the source's directory, never to the virtual path.
        reads: asked.filter((path) => path.endsWith('.ts') && toPosixPath(path).includes('/node_modules/')),
      };
      expect(answer.kept).toBe(layout.asked[0]);
      return { ...answer, kept: undefined };
    });
    const [onPosix, onWindows] = answers;
    expect(onWindows?.texts).toEqual(Array.from({ length: 3 }, () => 'export const money = 1;\n'));
    expect(onWindows?.exists).toEqual([true, true, true]);
    expect(onWindows?.listed).toEqual(onPosix?.listed);
    expect(onWindows?.listed).toEqual(['/node_modules/@acme/money/src/index.ts']);
    expect(onWindows?.above).toEqual(onPosix?.above);
    expect(onWindows?.scope).toBe(true);
    expect(onWindows?.reads).toEqual([]);
    expect(onPosix?.reads).toEqual([]);
  });

  it('names a mounted file by the same repo-relative id as the POSIX case', () => {
    const windows = normalizeFilePath(LAYOUTS.windows.real, LAYOUTS.windows.root);
    const posixId = normalizeFilePath(LAYOUTS.posix.real, LAYOUTS.posix.root);
    expect(windows).toBe('../../packages/money/src/index.ts');
    expect(windows).toBe(posixId);
    expect(normalizeFilePath(win32.join(LAYOUTS.windows.root, 'src', 'main.ts'), LAYOUTS.windows.root)).toBe('src/main.ts');
  });
});
