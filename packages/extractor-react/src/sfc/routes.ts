import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizeFilePath, normalizePath } from '@flowatlas/core';
import { routePathOfFile, type FsRouter } from '@flowatlas/adapters-entry';
import type { Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * Which component files are screens, and at what address (P233).
 *
 * Vue Router: an object with a `path` and a `component` anywhere in the
 * repository's code - a route of `createRouter({ routes })`, nested under a
 * parent's `children` - where the component is an import of a `.vue` file or
 * `() => import('./X.vue')`, lazy as Angular's routes are (R13). Nuxt and
 * SvelteKit: a page is a route by where it is, read as a row of the
 * file-system routers (`NUXT_PAGES`, `SVELTEKIT_PAGES`).
 */

const valueOf = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

const stringOf = (value: TsNode | undefined): string | undefined =>
  value !== undefined && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) ? value.getLiteralValue() : undefined;

/** The component file a module specifier names, repo-relative, when it is one. */
const componentFileOf = (from: SourceFile, specifier: string, repoDir: string, extensions: readonly string[]): string | undefined => {
  if (!extensions.some((extension) => specifier.endsWith(extension))) return undefined;
  const candidates = specifier.startsWith('.')
    ? [resolve(dirname(from.getFilePath()), specifier)]
    : /^[@~]\//.test(specifier)
      ? [join(repoDir, 'src', specifier.slice(2)), join(repoDir, specifier.slice(2))]
      : [];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found === undefined ? undefined : normalizeFilePath(found, repoDir);
};

/** The component a route's `component` names: an import, or a lazy `import()` of one. */
const routedFile = (value: TsNode | undefined, repoDir: string, extensions: readonly string[]): string | undefined => {
  if (value === undefined) return undefined;
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
    const body = value.getBody();
    const call = Node.isBlock(body) ? undefined : body;
    if (call !== undefined && Node.isCallExpression(call) && call.getExpression().getText() === 'import') {
      const specifier = stringOf(call.getArguments()[0]);
      return specifier === undefined ? undefined : componentFileOf(value.getSourceFile(), specifier, repoDir, extensions);
    }
    return undefined;
  }
  if (!Node.isIdentifier(value)) return undefined;
  for (const declaration of value.getSymbol()?.getDeclarations() ?? []) {
    const imported = Node.isImportClause(declaration)
      ? declaration.getParent()
      : Node.isImportSpecifier(declaration)
        ? declaration.getImportDeclaration()
        : undefined;
    if (imported === undefined || !Node.isImportDeclaration(imported)) continue;
    return componentFileOf(value.getSourceFile(), imported.getModuleSpecifierValue(), repoDir, extensions);
  }
  return undefined;
};

/** A route object's full path: its own, under every parent whose `children` it is in. */
const fullPath = (route: ObjectLiteralExpression): string | undefined => {
  const own = stringOf(valueOf(route, 'path'));
  if (own === undefined) return undefined;
  if (own.startsWith('/')) return own;
  const list = route.getParent();
  const property = list?.getParent();
  const parent = property?.getParent();
  if (list !== undefined && Node.isArrayLiteralExpression(list) && property !== undefined && Node.isPropertyAssignment(property) && property.getName() === 'children' && parent !== undefined && Node.isObjectLiteralExpression(parent)) {
    const above = fullPath(parent);
    return above === undefined ? own : `${above}/${own}`;
  }
  return `/${own}`;
};

/** Every component file the repository routes to, with the addresses it is shown at. */
export const routedComponents = (
  sources: readonly SourceFile[],
  componentFiles: readonly string[],
  options: {
    repoDir: string;
    extensions: readonly string[];
    pages: readonly FsRouter[];
    /** Files a framework's own reading has placed already, at their address (P243). */
    placed?: ReadonlyMap<string, string>;
  },
): Map<string, Set<string>> => {
  const routed = new Map<string, Set<string>>();
  const claim = (file: string, path: string): void => {
    routed.set(file, (routed.get(file) ?? new Set()).add(normalizePath(path)));
  };
  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isObjectLiteralExpression(node)) return;
      const component = valueOf(node, 'component');
      if (component === undefined) return;
      const path = fullPath(node);
      const file = path === undefined ? undefined : routedFile(component, options.repoDir, options.extensions);
      if (file !== undefined && path !== undefined) claim(file, path);
    });
  }
  for (const [file, path] of options.placed ?? []) claim(file, path);
  for (const router of options.pages) {
    for (const file of componentFiles) {
      // The router reads a script's name; a page's ending is the component format's,
      // and SvelteKit's `+page@(group).svelte` is the page of its folder, whatever layout it resets to (P258).
      const path = routePathOfFile(file.replace(/\/\+page@[^/]*\.svelte$/, '/+page.svelte').replace(/\.(vue|svelte)$/, '.ts'), router);
      if (path !== null) claim(file, path);
    }
  }
  return routed;
};
