import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const [first] = route.split('/').filter((segment) => segment !== '');
  // The address starts with a parameter, however the reader spells it (`:param`, `[locale]`).
  if (first === undefined || !(first.startsWith(':') || /^\[[^.\]]+\]$/.test(first))) return undefined;
  // The segment is the first under the application's pages, past its route groups, and names one value.
  const parts = file.split('/');
  for (let at = parts.length - 2; at >= 0; at -= 1) {
    if (parts[at] !== 'app' && parts[at] !== 'pages') continue;
    const below = parts.slice(at + 1, -1).find((part) => !/^\(.*\)$/.test(part));
    const name = below === undefined ? undefined : /^\[([A-Za-z_$][\w$]*)\]$/.exec(below)?.[1];
    if (below === undefined || name === undefined) continue;
    const above = parts.slice(0, at);
    if (above.at(-1) === 'src') above.pop();
    return declaresPrefix(repoDir, above.join('/'), name) ? below : undefined;
  }
  return undefined;
};
