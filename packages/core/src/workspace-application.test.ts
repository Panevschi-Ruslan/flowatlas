import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasDependency, readResolvedPackageJson } from './adapters/manifest.js';
import { applicationLibraryDirs, readServiceManifest, workspaceApplicationOf } from './workspace-application.js';
import { forgetWorkspaces, serviceSourceDirs } from './workspace.js';

const temporary: string[] = [];

afterEach(() => {
  forgetWorkspaces();
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const write = (path: string, content: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};

/**
 * A workspace that keeps one manifest for everything: `shop` and `orders` under
 * `apps/`, `order-events` and `money` under `libs/`, every project's tsconfig
 * extending the root's, which aliases both libraries.
 */
const oneManifestWorkspace = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-one-manifest-')));
  temporary.push(root);
  write(join(root, 'package.json'), { name: 'shop-workspace', dependencies: { '@nestjs/core': '^11.0.0' } });
  write(
    join(root, 'tsconfig.json'),
    // Comments and a trailing comma, which a tsconfig may carry.
    `{
      // the aliases every project shares
      "compilerOptions": {
        "baseUrl": "./",
        "paths": {
          "@shop/order-events": ["libs/order-events/src"],
          "@shop/money/*": ["libs/money/src/*"],
        },
      },
    }`,
  );
  for (const app of ['shop', 'orders']) write(join(root, 'apps', app, 'tsconfig.app.json'), { extends: '../../tsconfig.json' });
  write(join(root, 'apps/shop/src/main.ts'), "import { OrderEvents } from '@shop/order-events';\nexport const events = OrderEvents;\n");
  write(join(root, 'apps/orders/src/main.ts'), "import type { OrderPlaced } from '@shop/order-events';\nexport type Placed = OrderPlaced;\n");
  write(join(root, 'libs/order-events/src/index.ts'), "import { cents } from '@shop/money/cents';\nexport class OrderEvents { total = cents(1); }\nexport interface OrderPlaced { id: string }\n");
  write(join(root, 'libs/money/src/cents.ts'), 'export const cents = (n: number): number => n * 100;\n');
  return root;
};

describe('workspaceApplicationOf (R180)', () => {
  it('takes a directory with no manifest whose tsconfig extends the root as an application of the root', () => {
    const root = oneManifestWorkspace();
    expect(workspaceApplicationOf(join(root, 'apps/shop'))).toEqual({
      dir: join(root, 'apps/shop'),
      root,
      tsconfig: join(root, 'apps/shop/tsconfig.app.json'),
    });
  });

  it('does not take a directory whose tsconfig stands alone, though a manifest is above it', () => {
    const root = oneManifestWorkspace();
    write(join(root, 'functions/tsconfig.json'), { compilerOptions: { strict: true } });
    expect(workspaceApplicationOf(join(root, 'functions'))).toBeUndefined();
  });

  it('does not take a directory with a manifest of its own, nor one with no tsconfig', () => {
    const root = oneManifestWorkspace();
    write(join(root, 'apps/admin/package.json'), { name: 'admin' });
    write(join(root, 'apps/admin/tsconfig.json'), { extends: '../../tsconfig.json' });
    expect(workspaceApplicationOf(join(root, 'apps/admin'))).toBeUndefined();
    expect(workspaceApplicationOf(join(root, 'libs/money'))).toBeUndefined();
  });
});

describe('the manifest an application is built with (R180)', () => {
  it("is the root's, so detection sees the framework the root declares", () => {
    const root = oneManifestWorkspace();
    expect(readServiceManifest(join(root, 'apps/shop'))?.name).toBe('shop-workspace');
    expect(hasDependency(readResolvedPackageJson(join(root, 'apps/shop')) ?? {}, '@nestjs/core')).toBe(true);
  });

  it('is nothing for a directory that is no application, as before', () => {
    const root = oneManifestWorkspace();
    write(join(root, 'functions/tsconfig.json'), { compilerOptions: { strict: true } });
    expect(readResolvedPackageJson(join(root, 'functions'))).toBeUndefined();
  });
});

describe('applicationLibraryDirs (R180)', () => {
  it('takes the libraries the application imports by alias, and what they import in turn', () => {
    const root = oneManifestWorkspace();
    expect(applicationLibraryDirs(join(root, 'apps/shop'))).toEqual([
      join(root, 'libs/money/src'),
      join(root, 'libs/order-events/src'),
    ]);
    expect(serviceSourceDirs(join(root, 'apps/shop'))).toEqual([
      join(root, 'apps/shop'),
      join(root, 'libs/money/src'),
      join(root, 'libs/order-events/src'),
    ]);
  });

  it('leaves out a library whose types alone are imported', () => {
    const root = oneManifestWorkspace();
    expect(applicationLibraryDirs(join(root, 'apps/orders'))).toEqual([]);
    expect(serviceSourceDirs(join(root, 'apps/orders'))).toEqual([join(root, 'apps/orders')]);
  });
});
