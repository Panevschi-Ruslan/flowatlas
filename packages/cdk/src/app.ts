import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { toPosixPath, type Unresolved } from '@flowatlas/core';
import { Project, type ClassDeclaration, type SourceFile } from 'ts-morph';
import { AppDeployment, type DeploymentParts } from './deployment.js';
import { Interpreter } from './interpret.js';
import { cdkModuleOf } from './modules.js';
import { Construct } from './values.js';

/**
 * A CDK app of a repository: its `cdk.json`, the program it names, and the
 * TypeScript beside it (P57).
 *
 * `cdk.json` says how the app is run - `npx ts-node --prefer-ts-exts
 * bin/orders.ts` - and what context it is run with. The file the command runs
 * is the app's entry, read from its first statement. A command that runs
 * something else (a Python app, a compiled `.js` with no source beside it) is
 * said, and every stack of the TypeScript beside it is read on its own.
 */

/** Directories that hold no app source: installs, synthesised output, builds. */
const NOT_SOURCES = new Set(['node_modules', 'cdk.out', 'dist', 'build', '.git', '.flowatlas', '.serverless']);

/** How far below the repository a `cdk.json` is looked for: `infra/cdk.json` is one. */
const MOST_DEPTH = 3;

/** Every `cdk.json` of a repository, repo-relative and sorted. */
export const appFiles = (repoDir: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === 'cdk.json')) found.push(toPosixPath(relative(repoDir, join(dir, 'cdk.json'))));
    if (depth >= MOST_DEPTH) return;
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && !NOT_SOURCES.has(entry.name)) walk(join(dir, entry.name), depth + 1);
  };
  walk(repoDir, 0);
  return found.sort();
};

/** Every TypeScript source of an app, absolute. */
const sourcesOf = (appDir: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !NOT_SOURCES.has(entry.name)) walk(path);
      } else if (/\.[cm]?ts$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) {
        out.push(path);
      }
    }
  };
  walk(appDir);
  return out.sort();
};

/** What `cdk.json` says: the command, the file it runs, and the context. */
interface AppFile {
  readonly command?: string;
  readonly entry?: string;
  readonly context: Record<string, unknown>;
}

const readAppFile = (path: string): AppFile | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
  if (json === null || typeof json !== 'object') return undefined;
  const record = json as Record<string, unknown>;
  const command = typeof record['app'] === 'string' ? record['app'] : undefined;
  const entry = command?.split(/\s+/).find((part) => /\.(?:[cm]?ts|tsx)$/.test(part));
  const context = record['context'] !== null && typeof record['context'] === 'object' ? (record['context'] as Record<string, unknown>) : {};
  return { ...(command === undefined ? {} : { command }), ...(entry === undefined ? {} : { entry }), context };
};

/** Whether a source file imports anything of the CDK: the files an app is made of. */
const usesCdk = (source: SourceFile): boolean =>
  source.getImportDeclarations().some((declaration) => cdkModuleOf(declaration.getModuleSpecifierValue()) !== undefined);

export interface AppOptions {
  readonly repoDir: string;
  /** Repo-relative path of the app's `cdk.json`. */
  readonly file: string;
  /** What the deployment is run with: context values given on the command line. */
  readonly options: Readonly<Record<string, string>>;
}

/** One app, read into the parts of a deployment. Returns the sources it read. */
export const readApp = (parts: DeploymentParts, options: AppOptions): string[] => {
  const { repoDir, file } = options;
  const appDir = dirname(join(repoDir, file));
  const app = readAppFile(join(repoDir, file));
  const rows: Unresolved[] = parts.rows;
  if (app === undefined) {
    rows.push({ file, line: 1, reason: 'infra-file-unparsed', message: `${file} is not JSON`, hint: 'Nothing of this app is read.' });
    return [];
  }
  const project = new Project({ compilerOptions: { allowJs: false, noEmit: true, skipLibCheck: true, strict: false }, skipAddingFilesFromTsConfig: true });
  const sources = sourcesOf(appDir);
  for (const source of sources) project.addSourceFileAtPath(source);
  const interpreter = new Interpreter({ repoDir, context: { ...app.context, ...options.options } });
  const entry = app.entry === undefined ? undefined : project.getSourceFile(join(appDir, app.entry));
  const classes = project
    .getSourceFiles()
    .filter(usesCdk)
    .flatMap((source) => source.getClasses())
    .filter((cls: ClassDeclaration) => interpreter.isConstructClass(cls));
  if (entry !== undefined) {
    interpreter.runModule(entry);
    for (const cls of classes) {
      if (interpreter.instantiated.has(cls)) continue;
      rows.push({
        file: toPosixPath(relative(repoDir, cls.getSourceFile().getFilePath())),
        line: cls.getStartLineNumber(),
        reason: 'construct-unreached',
        level: 'info',
        message: `${cls.getName() ?? 'a class'} is a construct the app declares and never creates, so it is not read`,
        hint: 'Nothing to do unless it is deployed some other way.',
        symbol: cls.getName() ?? 'class',
      });
    }
  } else {
    rows.push({
      file,
      line: 1,
      reason: 'deployment-app-unread',
      message:
        app.command === undefined
          ? `${file} names no app, so what its stacks are handed is not known`
          : `${file} runs ${app.command}, which is not a TypeScript file of this repository, so what its stacks are handed is not known`,
      hint: 'Name a TypeScript app in cdk.json. Each stack is read on its own until then, with what it is handed unread.',
    });
    const root = new Construct('core.App', '', { file, line: 1 }, undefined, [], undefined, undefined);
    const stacks = classes.filter((cls) => {
      const heritage = cls.getExtends()?.getExpression().getText() ?? '';
      return /Stack$/.test(heritage);
    });
    for (const cls of stacks) interpreter.instantiateAlone(cls, root);
  }
  rows.push(...interpreter.rows);
  const deployment = new AppDeployment(parts, interpreter.constructs, repoDir, appDir);
  deployment.read();
  deployment.finish();
  return [file, ...sources.map((source) => toPosixPath(relative(repoDir, source)))].filter((path) => existsSync(join(repoDir, path)));
};
