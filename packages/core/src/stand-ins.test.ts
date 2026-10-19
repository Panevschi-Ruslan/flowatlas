import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { countsOf, wasMissed, type Unresolved } from './model/graph.js';
import { kindOfRow } from './model/row-kind.js';
import { packageSourcesFor, parseConfig, shapesFor } from './config.js';
import { readShapeFile, resolutionOrder, shapeFilesOf } from './declaration-shapes.js';
import { countSources, createProject } from './project.js';
import type { PackageSource } from './package-index.js';
import {
  markStandInEdges,
  mountOfPath,
  mountTableOf,
  packageCoverage,
  reportStandIns,
  standInFiles,
  standInOfFile,
  standInsFingerprint,
  standInsFingerprintOf,
  standInsFor,
  standInWants,
  withdrawPackageSourceRows,
  type Mount,
} from './stand-ins.js';
import { forgetPackageIndexes, packageIndexOf, type PackageIndex } from './package-index.js';
import { WORK_COUNTS } from './work-counts.js';
import { toPosixPath } from './ids.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const treeOf = (files: Record<string, unknown>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-stand-ins-')));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
};

const TSCONFIG = { compilerOptions: { strict: false, module: 'commonjs' }, include: ['src'] };

/** A project of two repositories and a shape file: the importer, and the library it imports. */
const PROJECT = {
  'loans/package.json': { name: 'loans', dependencies: { '@acme/money': '^2.0.0', '@acme/queue': '^1.0.0' } },
  'loans/tsconfig.json': TSCONFIG,
  'loans/src/main.ts': [
    "import { Money } from '@acme/money';",
    "import { Queue } from '@acme/queue';",
    'export const cash = new Money(3);',
    'export const price = cash.format();',
    'export const queue: Queue = new Queue();',
    "export const sent = queue.publish('loan.approved');",
    '',
  ].join('\n'),
  'money/package.json': { name: '@acme/money', version: '1.4.0', main: 'dist/index.js', types: 'dist/index.d.ts' },
  'money/src/index.ts': "export { Money } from './money';\n",
  'money/src/money.ts': 'export class Money { constructor(readonly amount: number) {} format(): string { return String(this.amount); } }\n',
  'shapes/queue.d.ts': [
    "declare module '@acme/queue' {",
    '  export class Queue { publish(topic: string): Promise<void>; }',
    '}',
    "declare module '@acme/money' {",
    '  export class Money { shaped(): void; }',
    '}',
    '',
  ].join('\n'),
};

const CONFIG = {
  services: [
    { name: 'loans', repo: './loans', type: 'nestjs' },
    { name: 'money-lib', repo: './money', type: 'nestjs' },
  ],
  shapes: ['./shapes/*.d.ts'],
};

const open = (root: string, config: Record<string, unknown> = CONFIG) => {
  const parsed = parseConfig(config);
  const standIns = standInsFor({ config: parsed, service: parsed.services[0], configDir: root });
  return createProject({ rootDir: join(root, 'loans'), ...(standIns === undefined ? {} : { standIns }) });
};

/** A path under the tree as the compiler names a file it read: forward slashes on every OS (P199). */
const compiled = (root: string, path: string): string => toPosixPath(join(root, path));

const declaredIn = (project: ReturnType<typeof open>, name: string): string | undefined =>
  project.getSourceFileOrThrow('main.ts').getVariableDeclarationOrThrow(name).getType().getSymbol()?.getDeclarations()[0]?.getSourceFile().getFilePath();

describe('the order a missing package is answered in', () => {
  it('is installed, then the source, then a shape file, then a built-in shape', () => {
    expect(resolutionOrder({ installed: true, 'package-from-repo': true, 'shape-file': true, 'built-in': true })).toBe('installed');
    expect(resolutionOrder({ 'package-from-repo': true, 'shape-file': true })).toBe('package-from-repo');
    expect(resolutionOrder({ 'shape-file': true, 'built-in': true })).toBe('shape-file');
    expect(resolutionOrder({ 'built-in': true })).toBe('built-in');
    expect(resolutionOrder({})).toBeUndefined();
  });

  it('reads the source of a repository that is the package, at the path an install would have', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    const declared = declaredIn(project, 'cash');
    expect(declared).toBe(compiled(root, 'loans/node_modules/@acme/money/src/money.ts'));
    expect(standInOfFile(project, declared as string)).toEqual({ via: 'package-from-repo', package: '@acme/money' });
    // Types only: the package's files are no source of the service.
    expect(countSources(project).files).toBe(1);
    expect(project.getSourceFiles().some((file) => file.getFilePath().includes('@acme/money'))).toBe(false);
  });

  it('reads a shape file for a package nothing on disk is, and not for one whose source is', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    expect(declaredIn(project, 'queue')).toBe(compiled(root, 'loans/node_modules/@acme/queue/index.d.ts'));
    expect([...shapeFilesOf(project)]).toEqual([['@acme/queue', join(root, 'shapes/queue.d.ts')]]);
    const call = project.getSourceFileOrThrow('main.ts').getVariableDeclarationOrThrow('sent').getType().getText();
    expect(call).toBe('Promise<void>');
  });

  it('lets an installed package win over both', () => {
    const root = treeOf({
      ...PROJECT,
      'loans/node_modules/@acme/money/package.json': { name: '@acme/money', types: 'index.d.ts' },
      'loans/node_modules/@acme/money/index.d.ts': 'export declare class Money { constructor(n: number); format(): string; }\n',
    });
    const project = open(root);
    expect(declaredIn(project, 'cash')).toBe(compiled(root, 'loans/node_modules/@acme/money/index.d.ts'));
    const money = project.getSourceFileOrThrow('main.ts').getImportDeclarations()[0]?.getModuleSpecifierSourceFile()?.getFilePath();
    expect(money).toBe(compiled(root, 'loans/node_modules/@acme/money/index.d.ts'));
    expect(standInOfFile(project, money as string)).toBeUndefined();
  });

  it('reads nothing in place of a package with packageSources off', () => {
    const root = treeOf(PROJECT);
    const project = open(root, { ...CONFIG, shapes: [], packageSources: false });
    const money = project.getSourceFileOrThrow('main.ts').getImportDeclarations()[0]?.getModuleSpecifierSourceFile();
    expect(money).toBeUndefined();
  });
});

describe('the rows that say what stood in', () => {
  it('says which repository answered, and that its version is not the one asked for', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    const builder = new GraphBuilder({ repo: 'loans' });
    reportStandIns({ project, repoDir: join(root, 'loans'), builder });
    const rows = builder.build().unresolved;
    const from = rows.find((row) => row.reason === 'package-from-repo');
    // A note at `info` (P81): read, not missed, and not a place with no edge.
    expect(from).toMatchObject({ level: 'info', symbol: '@acme/money', file: 'src/main.ts', line: 1 });
    expect(kindOfRow(from as Unresolved)).toBe('note');
    expect(wasMissed(from as Unresolved)).toBe(false);
    expect(from?.message).toContain('../money');
    expect(rows.find((row) => row.reason === 'package-version-differs')?.message).toContain('@acme/money@^2.0.0');
    // The money block of the shape file is not read: the source is.
    expect(rows.find((row) => row.reason === 'shape-file-unmatched')).toMatchObject({ symbol: '@acme/money', level: 'info' });
    expect(countsOf(rows)).toMatchObject({ missed: 0, notes: 3, findings: 0, nothing: 0 });
  });

  it('says a name two repositories claim is read from neither', () => {
    const root = treeOf({ ...PROJECT, 'money-copy/package.json': { name: '@acme/money' }, 'money-copy/src/index.ts': 'export {};\n' });
    const project = open(root, {
      ...CONFIG,
      services: [...CONFIG.services, { name: 'money-copy', repo: './money-copy', type: 'nestjs' }],
      shapes: [],
    });
    const builder = new GraphBuilder({ repo: 'loans' });
    reportStandIns({ project, repoDir: join(root, 'loans'), builder });
    const row = builder.build().unresolved.find((each) => each.reason === 'package-source-ambiguous');
    expect(row?.message).toContain('../money, ../money-copy');
    expect(row?.level).toBeUndefined();
  });

  it('says a listed shape file that is not there, or declares nothing, was not read', () => {
    const root = treeOf({ ...PROJECT, 'shapes/empty.d.ts': 'export declare const x: number;\n' });
    const project = open(root, { ...CONFIG, shapes: ['./shapes/*.d.ts', './shapes/gone.d.ts'] });
    const builder = new GraphBuilder({ repo: 'loans' });
    reportStandIns({ project, repoDir: join(root, 'loans'), builder });
    const unread = builder.build().unresolved.filter((row) => row.reason === 'shape-file-unread');
    expect(unread.map((row) => row.file).sort()).toEqual(['../shapes/empty.d.ts', '../shapes/gone.d.ts']);
  });

  it("takes back rows about a configured package's own files, which its own reading says once", () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    const builder = new GraphBuilder({ repo: 'loans' });
    builder.addUnresolved({ file: 'node_modules/@acme/money/src/money.ts', line: 1, reason: 'type-unresolved' });
    builder.addUnresolved({ file: 'src/main.ts', line: 3, reason: 'type-unresolved' });
    withdrawPackageSourceRows({ project, repoDir: join(root, 'loans'), builder });
    expect(builder.build().unresolved.map((row) => row.file)).toEqual(['src/main.ts']);
  });

  it('records the files the stand-ins were read from, for the cache', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    project.getProgram();
    expect(standInFiles(project, join(root, 'loans'))).toEqual([
      '../money/package.json',
      '../money/src/index.ts',
      '../money/src/money.ts',
      '../shapes/queue.d.ts',
    ]);
  });
});

describe('the mount a path is under (P82)', () => {
  const source = (name: string, dir: string): PackageSource => ({ name, dir, manifest: { name }, origin: 'service' });
  const mounts: Mount[] = [
    { source: source('money', '/work/money'), virtual: '/work/loans/node_modules/money' },
    { source: source('@acme/queue', '/work/queue'), virtual: '/work/loans/node_modules/@acme/queue' },
    { source: source('@acme/q', '/work/q'), virtual: '/work/loans/node_modules/@acme/q' },
  ];
  /** What every lookup was before the table: the first mount the path is at or under. */
  const scanned = (path: string): Mount | undefined =>
    mounts.find((mount) => path === mount.virtual || path.startsWith(`${mount.virtual}/`));
  const table = mountTableOf(mounts);

  it.each([
    ['a plain name', '/work/loans/node_modules/money/src/index.ts'],
    ['the root of a plain name', '/work/loans/node_modules/money'],
    ['a scoped name', '/work/loans/node_modules/@acme/queue/src/queue.ts'],
    ['the root of a scoped name', '/work/loans/node_modules/@acme/queue'],
    ['a scoped name that begins another', '/work/loans/node_modules/@acme/q/index.ts'],
    ['a name that only begins like a mounted one', '/work/loans/node_modules/money-extra/index.ts'],
    ['the scope alone', '/work/loans/node_modules/@acme'],
    ['a package installed inside a mounted one', '/work/loans/node_modules/money/node_modules/left-pad/index.js'],
    ['a scoped package inside a mounted one', '/work/loans/node_modules/@acme/queue/node_modules/@other/x/index.d.ts'],
    ['a mounted name under another service', '/work/orders/node_modules/money/index.ts'],
    ['the service itself', '/work/loans/src/main.ts'],
    ['node_modules with nothing after it', '/work/loans/node_modules/'],
  ])('answers as the scan did for %s', (_, path) => {
    expect(mountOfPath(table, path)).toBe(scanned(path));
  });

  it('refuses a mount that is not held at node_modules/<name>', () => {
    expect(() => mountTableOf([{ source: source('money', '/work/money'), virtual: '/work/loans/vendor/money' }])).toThrow(
      /node_modules/,
    );
  });

  it('walks the files a program read from its mounts once per program', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    project.getProgram();
    const before = WORK_COUNTS.mountedFileWalks;
    standInFiles(project, join(root, 'loans'));
    reportStandIns({ project, repoDir: join(root, 'loans'), builder: new GraphBuilder({ repo: 'loans' }) });
    standInFiles(project, join(root, 'loans'));
    expect(WORK_COUNTS.mountedFileWalks - before).toBe(1);
  });
});

describe('shape files', () => {
  it('reads every declare module block of a file, each as its own package', () => {
    const reading = readShapeFile('/x/shapes.d.ts', PROJECT['shapes/queue.d.ts']);
    expect(reading.problem).toBeUndefined();
    expect(reading.shapes.map((shape) => shape.package)).toEqual(['@acme/queue', '@acme/money']);
    expect(reading.shapes[0]?.declarations).toContain('export class Queue');
    expect(reading.shapes[0]?.origin).toBe('/x/shapes.d.ts');
  });

  it('exports what a block with no export of its own declares', () => {
    const reading = readShapeFile('/x/flags.d.ts', "declare module 'flags' {\n  function isOn(name: string): boolean;\n}\n");
    expect(reading.shapes[0]?.declarations).toBe('export function isOn(name: string): boolean;\n');
  });

  it('says why a file gives nothing', () => {
    expect(readShapeFile('/x/a.d.ts', undefined).problem).toContain('not there');
    expect(readShapeFile('/x/a.d.ts', 'declare module "x" {').problem).toContain('does not parse');
    expect(readShapeFile('/x/a.d.ts', 'export declare const x: number;').problem).toContain('declares no module');
  });

  it('are listed by path or glob, relative to the configuration, project first', () => {
    const root = treeOf({ 'shapes/a.d.ts': '', 'shapes/b.d.ts': '', 'shapes/nested/c.d.ts': '', 'own/d.d.ts': '' });
    expect(shapesFor({ shapes: ['./shapes/*.d.ts'] }, { shapes: ['own/d.d.ts'] }, root)).toEqual([
      join(root, 'shapes/a.d.ts'),
      join(root, 'shapes/b.d.ts'),
      join(root, 'own/d.d.ts'),
    ]);
    expect(shapesFor({ shapes: ['shapes/**/*.d.ts'] }, undefined, root)).toContain(join(root, 'shapes/nested/c.d.ts'));
    expect(shapesFor({ shapes: ['./missing.d.ts'] }, undefined, root)).toEqual([join(root, 'missing.d.ts')]);
  });

  it('package sources are on unless the project or the service says otherwise', () => {
    expect(packageSourcesFor(undefined, undefined)).toBe(true);
    expect(packageSourcesFor({ packageSources: false }, undefined)).toBe(false);
    expect(packageSourcesFor({ packageSources: false }, { packageSources: 'services' })).toBe('services');
  });
});

describe('markStandInEdges', () => {
  /** Lines 1-6 are the project's own; the two below are where the edges are drawn. */
  const MAIN = [
    PROJECT['loans/src/main.ts'].trimEnd(),
    "export const both = [new Money(1), queue.publish('loan.paid')];",
    'export const made = new Queue();',
    'export const plain = 2;',
    '',
  ].join('\n');

  const marked = (line: number) => {
    const root = treeOf({ ...PROJECT, 'loans/src/main.ts': MAIN });
    const project = open(root);
    const builder = new GraphBuilder({ repo: 'loans' });
    builder.addNode({ id: 'function:loans#src/main.ts:main', type: 'function', label: 'main', repo: 'loans' });
    builder.addNode({ id: 'producer:loans#src/main.ts:1:1', type: 'producer', label: 'publish', repo: 'loans' });
    const edge = builder.addEdge({
      from: 'function:loans#src/main.ts:main',
      to: 'producer:loans#src/main.ts:1:1',
      type: 'calls',
      confidence: 'static',
      file: 'src/main.ts',
      line,
    });
    markStandInEdges({ project, repoDir: join(root, 'loans'), builder });
    return edge;
  };

  it('takes the calls on a line before its new expressions, each in source order', () => {
    // `new Money` comes first in the text, but a call is asked first: the queue's shape types the edge.
    expect(marked(7)).toMatchObject({ confidence: 'heuristic', meta: { because: ['shape-file'], typedBy: '@acme/queue' } });
  });

  it('reads a line with only a new expression, and leaves a line with neither alone', () => {
    expect(marked(8)).toMatchObject({ confidence: 'heuristic', meta: { typedBy: '@acme/queue' } });
    expect(marked(9)).toMatchObject({ confidence: 'static' });
    expect(marked(9).meta).toBeUndefined();
  });
});

describe('packageCoverage', () => {
  it('names what the configuration would read in place of each package, the source first', () => {
    const root = treeOf(PROJECT);
    const coverage = packageCoverage(parseConfig(CONFIG), root);
    expect(coverage.get('@acme/money')).toEqual({ by: 'repo', from: 'money' });
    expect(coverage.get('@acme/queue')).toEqual({ by: 'shape', from: 'shapes/queue.d.ts' });
    expect(coverage.get('loans')).toEqual({ by: 'repo', from: 'loans' });
  });
});

describe('what a reading wanted, and what answered it (P83)', () => {
  const WANTS = {
    ...PROJECT,
    'loans/src/flags.ts': "import { isOn } from '@acme/flags';\nexport const on = isOn('x');\n",
    'loans/src/relative.ts': "import { cash } from './main';\nexport const again = cash;\n",
  };

  it('lists the names a source, a shape file or nothing answered, and not a relative import', () => {
    const root = treeOf(WANTS);
    const project = open(root);
    expect(standInWants(project)).toEqual(['@acme/flags', '@acme/money', '@acme/queue']);
  });

  it('lists a name two directories claim', () => {
    const root = treeOf({ ...WANTS, 'money-copy/package.json': { name: '@acme/money' }, 'money-copy/src/index.ts': 'export {};\n' });
    const project = open(root, {
      ...CONFIG,
      services: [...CONFIG.services, { name: 'money-copy', repo: './money-copy', type: 'nestjs' }],
    });
    expect(standInWants(project)).toContain('@acme/money');
    const fingerprint = standInsFingerprintOf(project, root);
    expect(fingerprint?.packages['@acme/money']).toEqual({ ambiguous: ['money', 'money-copy'] });
  });

  it('leaves out a package that is installed', () => {
    const root = treeOf({
      ...WANTS,
      'loans/node_modules/@acme/flags/package.json': { name: '@acme/flags', types: 'index.d.ts' },
      'loans/node_modules/@acme/flags/index.d.ts': 'export declare const isOn: (name: string) => boolean;\n',
    });
    expect(standInWants(open(root))).toEqual(['@acme/money', '@acme/queue']);
  });

  /** One index made the way a build makes it, for this tree. */
  const indexOf = (root: string): PackageIndex =>
    packageIndexOf({
      services: [
        { name: 'loans', dir: join(root, 'loans') },
        { name: 'money-lib', dir: join(root, 'money') },
      ],
      folders: root,
    });

  const fingerprintOf = (root: string, wants: readonly string[] = ['@acme/flags', '@acme/money', '@acme/queue']) =>
    standInsFingerprint({
      wants,
      index: indexOf(root),
      shapeFiles: shapesFor(parseConfig(CONFIG), undefined, root),
      configDir: root,
    });

  it('records each shape file and what answered each wanted name, relative to the configuration', () => {
    const root = treeOf(WANTS);
    const fingerprint = fingerprintOf(root);
    expect(Object.keys(fingerprint.shapes)).toEqual(['shapes/queue.d.ts']);
    expect(fingerprint.packages).toEqual({
      '@acme/flags': null,
      '@acme/money': { dir: 'money', manifestHash: expect.stringMatching(/^sha1:/) },
      '@acme/queue': null,
    });
    expect(standInsFingerprintOf(open(root), root)).toEqual(fingerprint);
  });

  it.each([
    ['a shape file added under the glob', (root: string) => writeFileSync(join(root, 'shapes/flags.d.ts'), "declare module '@acme/flags' { export const isOn: (n: string) => boolean; }\n")],
    ['a shape file edited', (root: string) => writeFileSync(join(root, 'shapes/queue.d.ts'), '// emptied\n')],
    ['a shape file removed', (root: string) => rmSync(join(root, 'shapes/queue.d.ts'))],
    ['a directory now answering a missing name', (root: string) => {
      mkdirSync(join(root, 'flags'), { recursive: true });
      writeFileSync(join(root, 'flags/package.json'), JSON.stringify({ name: '@acme/flags' }));
    }],
    ['two directories now claiming a missing name', (root: string) => {
      for (const dir of ['flags', 'flags-copy']) {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name: '@acme/flags' }));
      }
    }],
    ['a mounted manifest edited', (root: string) => {
      writeFileSync(join(root, 'money/package.json'), JSON.stringify({ name: '@acme/money', version: '2.0.0' }));
    }],
  ])('changes for %s', (_, move) => {
    const root = treeOf(WANTS);
    const before = fingerprintOf(root);
    move(root);
    forgetPackageIndexes();
    expect(fingerprintOf(root)).not.toEqual(before);
  });

  it('does not change for a package nothing wanted, a weaker claim, or the order the names come in', () => {
    const root = treeOf(WANTS);
    const before = fingerprintOf(root);
    mkdirSync(join(root, 'ledger'), { recursive: true });
    writeFileSync(join(root, 'ledger/package.json'), JSON.stringify({ name: '@acme/ledger' }));
    // A directory beside the configuration does not take a name from a
    // configured repository, so the answer for it stays the repository.
    mkdirSync(join(root, 'money-copy'), { recursive: true });
    writeFileSync(join(root, 'money-copy/package.json'), JSON.stringify({ name: '@acme/money' }));
    forgetPackageIndexes();
    expect(fingerprintOf(root, ['@acme/queue', '@acme/money', '@acme/flags'])).toEqual(before);
  });

  it('answers nothing for a service with package sources off', () => {
    const root = treeOf(WANTS);
    const fingerprint = standInsFingerprint({ wants: ['@acme/money'], index: undefined, shapeFiles: [], configDir: root });
    expect(fingerprint).toEqual({ shapes: {}, packages: {} });
  });
});
