import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdkLibraryOf } from './library.js';

/** A repository with these files, the app in `infra/`. */
const repo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-library-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(join(dir, 'infra'), { recursive: true });
  return dir;
};

/** What is said of the version, and whether it is 2.180.0 or later, and 2.100.0 or later. */
const answers = (files: Record<string, string>): [string | undefined, boolean | undefined, boolean | undefined] => {
  const dir = repo(files);
  const library = cdkLibraryOf(join(dir, 'infra'), dir);
  return [library.said, library.atLeast('2.180.0'), library.atLeast('2.100.0')];
};

describe('the version of the CDK an app is built with (P322)', () => {
  it('reads the library installed beside the app before any lockfile', () => {
    expect(
      answers({
        'infra/node_modules/aws-cdk-lib/package.json': JSON.stringify({ version: '2.150.0' }),
        'package-lock.json': JSON.stringify({ packages: { 'node_modules/aws-cdk-lib': { version: '2.200.0' } } }),
      }),
    ).toEqual(['aws-cdk-lib 2.150.0 (infra/node_modules)', false, true]);
  });

  it("reads npm's, pnpm's and yarn's lockfiles, every version they pin asked", () => {
    expect(answers({ 'package-lock.json': JSON.stringify({ packages: { 'node_modules/aws-cdk-lib': { version: '2.200.0' } } }) })).toEqual([
      'aws-cdk-lib 2.200.0 (package-lock.json)',
      true,
      true,
    ]);
    expect(answers({ 'pnpm-lock.yaml': 'packages:\n  /aws-cdk-lib@2.120.0(constructs@10.3.0):\n    resolution: {}\n  aws-cdk-lib@2.190.0:\n    resolution: {}\n' })).toEqual([
      'aws-cdk-lib 2.120.0, 2.190.0 (pnpm-lock.yaml)',
      undefined,
      true,
    ]);
    expect(answers({ 'yarn.lock': 'aws-cdk-lib@^2.180.0:\n  version "2.181.0"\n  resolved "x"\n' })).toEqual(['aws-cdk-lib 2.181.0 (yarn.lock)', true, true]);
    expect(answers({ 'yarn.lock': '"aws-cdk-lib@npm:^2.100.0":\n  version: 2.101.0\n  resolution: "x"\n' })).toEqual(['aws-cdk-lib 2.101.0 (yarn.lock)', false, true]);
  });

  it("reads the range a package.json asks for, settled only where every version it allows says the same, and version 1's packages", () => {
    expect(answers({ 'infra/package.json': JSON.stringify({ dependencies: { 'aws-cdk-lib': '^2.190.0' } }) })).toEqual(['aws-cdk-lib ^2.190.0 (infra/package.json)', true, true]);
    expect(answers({ 'package.json': JSON.stringify({ devDependencies: { 'aws-cdk-lib': '^2.150.0' } }) })).toEqual(['aws-cdk-lib ^2.150.0 (package.json)', undefined, true]);
    expect(answers({ 'package.json': JSON.stringify({ dependencies: { 'aws-cdk-lib': '2.170.0' } }) })).toEqual(['aws-cdk-lib 2.170.0 (package.json)', false, true]);
    expect(answers({ 'package.json': JSON.stringify({ dependencies: { '@aws-cdk/core': '^1.180.0' } }) })).toEqual(['@aws-cdk/core ^1.180.0 (package.json)', false, false]);
    expect(answers({})).toEqual([undefined, undefined, undefined]);
  });
});

describe('the version of the CDK a workspace member is built with (P348)', () => {
  /** A workspace whose member `services/billing` holds the app in `infra/`, the member read as the repository. */
  const member = (files: Record<string, string>): [string | undefined, readonly string[]] => {
    const dir = repo(files);
    mkdirSync(join(dir, 'services', 'billing', 'infra'), { recursive: true });
    const library = cdkLibraryOf(join(dir, 'services', 'billing', 'infra'), join(dir, 'services', 'billing'));
    return [library.said, library.files];
  };
  const lock = JSON.stringify({ packages: { 'node_modules/aws-cdk-lib': { version: '2.200.0' } } });

  it("reads the lockfile at the root of the workspace that declares the repository, past the repository's own directory", () => {
    expect(member({ 'package.json': JSON.stringify({ workspaces: ['services/*'] }), 'package-lock.json': lock })).toEqual([
      'aws-cdk-lib 2.200.0 (../../package-lock.json)',
      ['../../package-lock.json'],
    ]);
    expect(member({ 'pnpm-workspace.yaml': "packages:\n  - 'services/*'\n", 'pnpm-lock.yaml': 'packages:\n  aws-cdk-lib@2.190.0:\n    resolution: {}\n' })[0]).toBe(
      'aws-cdk-lib 2.190.0 (../../pnpm-lock.yaml)',
    );
  });

  it('keeps what the repository itself pins first, and reads nothing above a directory no workspace declares it in', () => {
    expect(
      member({
        'package.json': JSON.stringify({ workspaces: ['services/*'] }),
        'package-lock.json': lock,
        'services/billing/package.json': JSON.stringify({ name: 'billing', dependencies: { 'aws-cdk-lib': '2.150.0' } }),
        'services/billing/package-lock.json': JSON.stringify({ packages: { 'node_modules/aws-cdk-lib': { version: '2.150.0' } } }),
      })[0],
    ).toBe('aws-cdk-lib 2.150.0 (package-lock.json)');
    expect(member({ 'package.json': JSON.stringify({ workspaces: ['apps/*'] }), 'package-lock.json': lock })).toEqual([undefined, []]);
  });
});
