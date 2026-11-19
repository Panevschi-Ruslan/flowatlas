import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Node, Project, type Node as TsNode } from 'ts-morph';
import type { Written } from './dotenv.js';
import { environmentName } from './files.js';

/**
 * The settings an Angular application's environment files give it (P280).
 *
 * `src/environments/environment.ts` writes `export const environment = {
 * apiUrl: 'https://api.example.test' }`, and the build swaps it for
 * `environment.prod.ts` (or any `environment.<name>.ts`) where `angular.json`
 * replaces one with the other. Code reads `environment.apiUrl`, which the
 * Angular reader records as the setting `apiUrl`, so each value is kept under
 * that name: the keys after the object, joined with dots where it nests them
 * (`api.baseUrl`). The file a configuration swaps in names its environment;
 * the one it replaces names none, since which configuration it stands for is
 * the project's own choice.
 */
export interface EnvironmentFile {
  /** Repository-relative, POSIX. */
  readonly file: string;
  readonly environment?: string;
  readonly written: readonly Written[];
}

/** `environment.ts`, `environment.prod.ts`, `environment.development.ts`. */
const ENVIRONMENT_FILE = /^environment(?:\.([\w-]+))?\.ts$/;

/** The names the object a file exports may be held by. */
const ROOTS = new Set(['environment', 'env']);

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** The directories environment files are kept in: each project's `<sourceRoot>/environments`, or `src/environments`. */
const directoriesOf = (repoDir: string): string[] => {
  const roots = new Set<string>(['src']);
  const workspace = read(join(repoDir, 'angular.json'));
  if (workspace !== undefined) {
    try {
      const parsed = JSON.parse(workspace) as { projects?: Record<string, { sourceRoot?: unknown }> };
      for (const project of Object.values(parsed.projects ?? {})) {
        if (typeof project.sourceRoot === 'string' && !project.sourceRoot.includes('..')) roots.add(project.sourceRoot.replace(/\/+$/, ''));
      }
    } catch {
      // A workspace file nobody can parse names no other directory.
    }
  }
  return [...roots].sort().map((root) => `${root}/environments`);
};

/** The text values an object literal writes, under the keys that lead to each. */
const valuesIn = (object: TsNode, prefix: string, out: Written[]): void => {
  if (!Node.isObjectLiteralExpression(object)) return;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const name = `${prefix}${property.getName().replace(/^['"]|['"]$/g, '')}`;
    const value = property.getInitializer();
    if (value === undefined) continue;
    if (Node.isObjectLiteralExpression(value)) valuesIn(value, `${name}.`, out);
    else if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
      const raw = value.getLiteralText();
      if (raw !== '') out.push({ name, raw });
    }
  }
};

/** The values one environment file writes into the object it exports. */
export const readEnvironmentFile = (text: string): Written[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: false } });
  const source = project.createSourceFile('environment.ts', text);
  const out: Written[] = [];
  for (const declaration of source.getVariableDeclarations()) {
    if (!ROOTS.has(declaration.getName())) continue;
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) valuesIn(Node.isAsExpression(initializer) || Node.isSatisfiesExpression(initializer) ? initializer.getExpression() : initializer, '', out);
  }
  return out;
};

/** Every environment file of an Angular repository, with the values it writes. */
export const angularEnvironmentsOf = (repoDir: string): EnvironmentFile[] => {
  const found: EnvironmentFile[] = [];
  for (const dir of directoriesOf(repoDir)) {
    let names: string[];
    try {
      names = readdirSync(join(repoDir, dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && ENVIRONMENT_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const text = read(join(repoDir, dir, name));
      if (text === undefined) continue;
      const word = ENVIRONMENT_FILE.exec(name)?.[1];
      found.push({ file: `${dir}/${name}`, ...(word === undefined ? {} : { environment: environmentName(word) }), written: readEnvironmentFile(text) });
    }
  }
  return found;
};
