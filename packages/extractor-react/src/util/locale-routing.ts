import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateExpression } from '@flowatlas/core';
import type { Node as TsNode, Project } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * Where a front end puts the visitor's locale in front of every address
 * (P291): pages under one dynamic segment at the top of the application's
 * pages (`app/[locale]/search/page.tsx`), and a middleware that rewrites an
 * address written without it - next-intl's `createMiddleware`, a middleware
 * of the application's own that reads the locale and rewrites or redirects -
 * or a routing configuration that does the same (the framework's rewrites
 * naming the segment, a package that routes by locale). A navigation written
 * without the prefix (`/search`) is shown the page under it.
 */

/** Packages whose one work is to route by locale. */
const LOCALE_ROUTERS = /["'](?:next-intl|next-i18n-router|next-international|next-globe-gen|@formatjs\/intl-localematcher|negotiator|@inlang\/paraglide-next)(?:\/[^"']*)?["']/;

/** The files a middleware is written in, by the framework's name for it. */
const MIDDLEWARE_FILES = ['middleware', 'proxy'].flatMap((name) => ['ts', 'js', 'mjs', 'tsx', 'jsx'].map((extension) => `${name}.${extension}`));
const CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];

const textOf = (path: string): string | undefined => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
};

const DECLARED = new Map<string, boolean>();

/**
 * Whether the application at `root` (repo-relative) declares that it puts a
 * value in the segment named `name` in front of an address written without
 * it: a middleware that imports a locale router, or reads that name and
 * rewrites or redirects; the framework's rewrites naming it; or a locale
 * router the application depends on.
 */
const declaresPrefix = (repoDir: string, root: string, name: string): boolean => {
  const key = `${repoDir}\u0000${root}\u0000${name}`;
  const known = DECLARED.get(key);
  if (known !== undefined) return known;
  const base = join(repoDir, root);
  const named = new RegExp(name.replace(/[^A-Za-z0-9]/g, ''), 'i');
  const middleware = ['', 'src'].flatMap((directory) => MIDDLEWARE_FILES.map((file) => textOf(join(base, directory, file)))).filter((text): text is string => text !== undefined);
  const config = CONFIG_FILES.map((file) => textOf(join(base, file))).filter((text): text is string => text !== undefined);
  const manifest = textOf(join(base, 'package.json')) ?? '';
  const found =
    middleware.some((text) => LOCALE_ROUTERS.test(text) || (named.test(text) && /\b(?:rewrite|redirect)\s*\(/.test(text))) ||
    config.some((text) => /\brewrites\b/.test(text) && named.test(text)) ||
    LOCALE_ROUTERS.test(manifest.replace(/"(?:devDependencies|peerDependencies)"\s*:\s*\{[^}]*\}/g, ''));
  DECLARED.set(key, found);
  return found;
};

/**
 * The locale segment a page's address starts with, where the application
 * declares a middleware or a routing configuration that adds it: `[locale]`
 * for `app/[locale]/search/page.tsx` at `/[locale]/search`. Nothing for a
 * page not under such a segment, or an application that declares none.
 */
export const localePrefixOf = (repoDir: string, file: string, route: string): string | undefined => {
  const segment = topSegmentOf(file, route);
  return segment !== undefined && declaresPrefix(repoDir, segment.root, segment.name) ? segment.segment : undefined;
};

/** The one dynamic segment at the top of a page's address, where the page's file is under it: its text, its name, its directory, the application's root. */
interface TopSegment {
  readonly segment: string;
  readonly name: string;
  readonly directory: string;
  readonly root: string;
}

const topSegmentOf = (file: string, route: string): TopSegment | undefined => {
  const [first] = route.split('/').filter((segment) => segment !== '');
  // The address starts with a parameter, however the reader spells it (`:param`, `[locale]`).
  if (first === undefined || !(first.startsWith(':') || /^\[[^.\]]+\]$/.test(first))) return undefined;
  // The segment is the first under the application's pages, past its route groups, and names one value.
  const parts = file.split('/');
  for (let at = parts.length - 2; at >= 0; at -= 1) {
    if (parts[at] !== 'app' && parts[at] !== 'pages') continue;
    const inside = parts.slice(at + 1, -1);
    const index = inside.findIndex((part) => !/^\(.*\)$/.test(part));
    const below = index === -1 ? undefined : inside[index];
    const name = below === undefined ? undefined : /^\[([A-Za-z_$][\w$]*)\]$/.exec(below)?.[1];
    if (below === undefined || name === undefined) continue;
    const above = parts.slice(0, at);
    if (above.at(-1) === 'src') above.pop();
    return { segment: below, name, directory: [...parts.slice(0, at + 1), ...inside.slice(0, index + 1)].join('/'), root: above.join('/') };
  }
  return undefined;
};

/**
 * The dynamic segment at the top of a page's address whatever declares it
 * (P297): `[locale]` for `app/[locale]/search/page.tsx`. A link of the
 * application's own that puts the locale in front itself (`<LangLink
 * href>` calling `withLang(locale, href)`) lands under it where no
 * middleware or routing configuration says so.
 */
export const localeSegmentOf = (file: string, route: string): string | undefined => topSegmentOf(file, route)?.segment;

const LOCALES = new Map<string, readonly string[] | null>();

/** The texts a list holds, where every item is one. */
const textsOf = (node: TsNode | undefined): string[] | undefined => {
  if (node === undefined) return undefined;
  const value = evaluateExpression(node);
  return value.resolved && Array.isArray(value.value) && value.value.length > 0 && value.value.every((each) => typeof each === 'string') ? (value.value as string[]) : undefined;
};

/** The locales a `generateStaticParams` hands back for the segment named `name`: `[{ locale: 'en' }, ...]`, or `LOCALES.map((locale) => ({ locale }))`. */
const staticParamLocales = (fn: TsNode, name: string): string[] | undefined => {
  const body = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) ? fn.getBody() : undefined;
  if (body === undefined) return undefined;
  const returned = Node.isBlock(body) ? body.getDescendantsOfKind(SyntaxKind.ReturnStatement).map((each) => each.getExpression()).find((each) => each !== undefined) : body;
  let value = returned;
  while (value !== undefined && (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isSatisfiesExpression(value) || Node.isAwaitExpression(value))) value = value.getExpression();
  if (value === undefined) return undefined;
  const read = evaluateExpression(value);
  if (read.resolved && Array.isArray(read.value)) {
    const found = read.value.map((each) => (each !== null && typeof each === 'object' ? (each as Record<string, unknown>)[name] : undefined));
    return found.length > 0 && found.every((each) => typeof each === 'string') ? (found as string[]) : undefined;
  }
  if (!Node.isCallExpression(value)) return undefined;
  const callee = value.getExpression();
  const [mapper] = value.getArguments();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'map' || mapper === undefined || (!Node.isArrowFunction(mapper) && !Node.isFunctionExpression(mapper))) return undefined;
  const [parameter] = mapper.getParameters();
  const made = mapper.getBody();
  let object: TsNode | undefined = Node.isBlock(made) ? made.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression() : made;
  while (object !== undefined && Node.isParenthesizedExpression(object)) object = object.getExpression();
  if (parameter === undefined || object === undefined || !Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(name);
  const written = property === undefined ? undefined : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (written === undefined || written.getText() !== parameter.getName()) return undefined;
  return textsOf(callee.getExpression());
};

/**
 * The locales an application declares for the segment a page is under
 * (P297): its Next configuration's `i18n.locales`, next-intl's
 * `defineRouting({ locales })`, or the values the segment's
 * `generateStaticParams` hands back. Nothing where none is declared, and a
 * first segment is then taken for a locale by its shape.
 */
export const declaredLocalesOf = (project: Project, repoDir: string, file: string, route: string): readonly string[] | undefined => {
  const segment = topSegmentOf(file, route);
  if (segment === undefined) return undefined;
  const key = `${repoDir}\u0000${segment.directory}`;
  const known = LOCALES.get(key);
  if (known !== undefined) return known ?? undefined;
  const found = readLocales(project, repoDir, segment);
  LOCALES.set(key, found ?? null);
  return found;
};

const readLocales = (project: Project, repoDir: string, segment: TopSegment): readonly string[] | undefined => {
  const base = join(repoDir, segment.root);
  const inside = (path: string): boolean => path.startsWith(`${base}/`) && !path.includes('/node_modules/');
  // The segment's own layout or page: what it hands to the router is the set of values it is built for.
  const directory = join(repoDir, segment.directory);
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath();
    if (!path.startsWith(`${directory}/`) || path.slice(directory.length + 1).includes('/') || !/^(?:layout|page)\.[jt]sx?$/.test(path.slice(directory.length + 1))) continue;
    for (const declaration of source.getExportedDeclarations().get('generateStaticParams') ?? []) {
      const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
      const read = fn === undefined ? undefined : staticParamLocales(fn, segment.name);
      if (read !== undefined) return read;
    }
  }
  // next-intl's routing: `defineRouting({ locales: [...] })` anywhere in the application.
  for (const source of project.getSourceFiles()) {
    if (!inside(source.getFilePath()) || !source.getFullText().includes('defineRouting')) continue;
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== 'defineRouting') continue;
      const [options] = call.getArguments();
      const property = options !== undefined && Node.isObjectLiteralExpression(options) ? options.getProperty('locales') : undefined;
      const read = property === undefined ? undefined : textsOf(Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined);
      if (read !== undefined) return read;
    }
  }
  // The framework's own: `i18n: { locales: ['en', 'fr'] }` in its configuration.
  for (const name of CONFIG_FILES) {
    const text = textOf(join(base, name));
    const list = text === undefined ? undefined : /\bi18n\s*:\s*\{[^}]*?\blocales\s*:\s*\[([^\]]*)\]/.exec(text)?.[1];
    const read = list === undefined ? [] : [...list.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1] as string);
    if (read.length > 0) return read;
  }
  return undefined;
};
