import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { packageSourcesFor, parseConfig, shapesFor } from './config.js';
import { readShapeFile, resolutionOrder, shapeFilesOf } from './declaration-shapes.js';
import { countSources, createProject } from './project.js';
import {
  markStandInEdges,
  packageCoverage,
  reportStandIns,
  standInFiles,
  standInOfFile,
  standInsFor,
  withdrawPackageSourceRows,
} from './stand-ins.js';

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
    expect(declared).toBe(join(root, 'loans/node_modules/@acme/money/src/money.ts'));
    expect(standInOfFile(project, declared as string)).toEqual({ via: 'package-from-repo', package: '@acme/money' });
    // Types only: the package's files are no source of the service.
    expect(countSources(project).files).toBe(1);
    expect(project.getSourceFiles().some((file) => file.getFilePath().includes('@acme/money'))).toBe(false);
  });

  it('reads a shape file for a package nothing on disk is, and not for one whose source is', () => {
    const root = treeOf(PROJECT);
    const project = open(root);
    expect(declaredIn(project, 'queue')).toBe(join(root, 'loans/node_modules/@acme/queue/index.d.ts'));
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
    expect(declaredIn(project, 'cash')).toBe(join(root, 'loans/node_modules/@acme/money/index.d.ts'));
    const money = project.getSourceFileOrThrow('main.ts').getImportDeclarations()[0]?.getModuleSpecifierSourceFile()?.getFilePath();
    expect(money).toBe(join(root, 'loans/node_modules/@acme/money/index.d.ts'));
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
    expect(from).toMatchObject({ level: 'nothing', symbol: '@acme/money', file: 'src/main.ts', line: 1 });
    expect(from?.message).toContain('../money');
    expect(rows.find((row) => row.reason === 'package-version-differs')?.message).toContain('@acme/money@^2.0.0');
    // The money block of the shape file is not read: the source is.
    expect(rows.find((row) => row.reason === 'shape-file-unmatched')).toMatchObject({ symbol: '@acme/money', level: 'nothing' });
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
