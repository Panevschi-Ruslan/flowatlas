import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasDependency, NAVIGATES_META, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { spelledPaths } from '../util/path-text.js';
import { svelteMarkupEvents, svelteMarkupTags, vueTemplateEvents, vueTemplateTags } from './events.js';

/**
 * Where a front end navigates, each navigation joined to the page it shows:
 * Nuxt's `navigateTo(...)` and `<NuxtLink to>` (P265), and every other
 * router's (P276) - `push` and `replace` on Vue Router's, Next's or React
 * Router's router however it was got (`useRouter()`, `createRouter(...)`,
 * `createBrowserRouter(...)`, Next's `Router`, `this.$router`), React
 * Router's `navigate` from `useNavigate()`, SvelteKit's `goto`, a
 * `redirect(...)` a loader, an action or a server component throws or
 * returns, `<RouterLink to>` in a Vue template, and `<Link to>`,
 * `<NavLink to>` and Next's `<Link href>` in JSX.
 *
 * A navigation is a call of the page it lands on: the router shows that
 * page, runs its middleware and its setup, and what they request is what
 * the navigation does next. So it is a `calls` edge from the function that
 * navigates (the component, for a link or a call in its setup) to the page's
 * component, `static`, with `meta.navigates` the address written and
 * `meta.route` the page's: a flow from a button reaches the next page, and a
 * middleware that redirects reaches the page it sends the visitor to.
 *
 * What the page is, is the router's answer, read the way the router reads
 * it: a path matched against every page's address - a static segment before
 * a parameter, a parameter before a catch-all - and a name (`{ name, params
 * }`) against the name Nuxt gives a page from its file (`orders/[id].vue` is
 * `orders-id`), the one its `definePageMeta({ name })` writes, or the one a
 * Vue Router route writes. A path written as a template is matched with each
 * `${…}` as a parameter. An address with a host, or `{ external: true }`,
 * leaves the application: a note, not a join. An address written as code,
 * and one no page shows, are rows. A step through the history
 * (`navigate(-1)`) names no page and says nothing. `abortNavigation()` is
 * recorded on the function that calls it (`meta.abortsNavigation`): the
 * navigation it is called in shows nothing.
 */

/** A page the router can show: its file, its address, its name. */
export interface Page {
  readonly file: string;
  readonly route: string;
  readonly name?: string;
  readonly fn: IndexedFunction;
  /** The address was read through a branch nothing written decides (P288). */
  readonly guessed?: true;
  /** The conditions the route placing it is written under, each `condition:side` (P291). */
  readonly branches?: readonly string[];
  /** The segment a middleware puts in front of an address written without it, `[locale]` (P291). */
  readonly localePrefix?: string;
  /** The ids of the components whose bodies write a route placing it (P291). */
  readonly within?: readonly string[];
}

/** A navigation that lands on a page. */
type PageLanding = { readonly kind: 'page'; readonly page: Page; readonly by: 'path' | 'name'; readonly written: string; readonly guessed?: true; readonly localePrefix?: string };

/** Where a navigation lands, as the router decides it. */
type Landing =
  | PageLanding
  /** Pages at one address, each placed under its own side of a condition nothing written decides (P291). */
  | { readonly kind: 'branches'; readonly landings: readonly PageLanding[] }
  | { readonly kind: 'external'; readonly written: string }
  | { readonly kind: 'unresolved'; readonly why: 'missing' | 'dynamic' | 'ambiguous'; readonly written: string };

/**
 * Whether no two of these pages are placed together: for each two, a
 * condition one is placed under on one side and the other on the other
 * (`env.X ? <Switch>a</Switch> : <Switch>b</Switch>`), so which one is at the
 * address is the build's choice, not a clash (P291).
 */
const exclusive = (pages: readonly Page[]): boolean =>
  pages.every((a, index) =>
    pages.slice(index + 1).every((b) =>
      (a.branches ?? []).some((mark) => {
        const at = mark.lastIndexOf(':');
        const condition = mark.slice(0, at);
        return (b.branches ?? []).some((other) => other.startsWith(`${condition}:`) && other !== mark);
      }),
    ),
  );

/** How sure a navigation's edge is: a branch nothing decides, or a prefix a middleware adds, is a guess (P288, P291). */
export const navigationConfidence = (meta: Readonly<Record<string, unknown>>): 'heuristic' | 'static' =>
  meta['branch'] === true || meta['localePrefix'] !== undefined ? 'heuristic' : 'static';

type DrawEdge = (from: IndexedFunction, to: IndexedFunction, file: string, line: number, meta: Record<string, unknown>) => void;

/** The components a template writes a link with. */
const LINK_TAGS: ReadonlySet<string> = new Set(['NuxtLink', 'nuxt-link', 'RouterLink', 'router-link']);

/** The link Vue Router registers by name, outside Nuxt (P276). */
const VUE_ROUTER_LINK_TAGS: ReadonlySet<string> = new Set(['RouterLink', 'router-link']);

/** A navigation edge's drawing, shared with the reader that draws a component's children. */
export type { DrawEdge };

/** The modules Nuxt's own `navigateTo` may be imported from; written nowhere, it is auto-imported. */
const NUXT_MODULES: ReadonlySet<string> = new Set(['#app', '#imports', 'nuxt/app', '#app/composables/router']);

/** An address that leaves the application: a scheme, or a host written after `//`. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** The name Nuxt gives a page from its file under `pages/`: `orders/[id].vue` is `orders-id`, `index.vue` is `index`. */
export const pageNameOf = (file: string): string | undefined => {
  const at = file.lastIndexOf('pages/');
  if (at === -1 || (at > 0 && file[at - 1] !== '/')) return undefined;
  const parts = file
    .slice(at + 'pages/'.length)
    .replace(/\.[^./]+$/, '')
    .split('/')
    // A route group is no part of the address, or of the name.
    .filter((part) => !/^\(.*\)$/.test(part))
    .map((part) => part.replace(/\[\[?(?:\.\.\.)?([^\]]*)\]\]?/g, '$1'));
  if (parts.at(-1) === 'index') parts.pop();
  return parts.length === 0 ? 'index' : parts.join('-');
};

/** The name a page's `definePageMeta({ name })` writes, where it writes one as a literal. */
const declaredName = (script: SourceFile | undefined): string | undefined => {
  let found: string | undefined;
  script?.forEachDescendant((node, traversal) => {
    if (!Node.isCallExpression(node) || node.getExpression().getText() !== 'definePageMeta') return;
    traversal.stop();
    const [first] = node.getArguments();
    const property = first !== undefined && Node.isObjectLiteralExpression(first) ? first.getProperty('name') : undefined;
    const value = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
    if (value !== undefined && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) found = value.getLiteralValue();
  });
  return found;
};

/** A segment of an address that stands for any value: `:id`, `:param`, `[id]`. */
const isParam = (segment: string): boolean => segment.startsWith(':') || /^\[.*\]$/.test(segment);
const isCatchAll = (segment: string): boolean => segment === '*' || segment === '**' || /^:[^/]*\(\.\*\)\*?$/.test(segment) || /^\[\.\.\./.test(segment) || segment.endsWith('*');

/** The segments of a path, past its query and its fragment. */
const segmentsOf = (path: string): string[] =>
  path
    .split(/[?#]/)[0]
    ?.split('/')
    .filter((segment) => segment !== '') ?? [];

/**
 * How well a path written as segments fits a page's address: a static
 * segment counts more than a parameter, and a catch-all least; `undefined`
 * where it does not fit. A written segment that is a hole (`\u0000`) fits only
 * a parameter or a catch-all.
 */
const fitOf = (written: readonly string[], route: string): number | undefined => {
  const pattern = segmentsOf(route);
  let score = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index] as string;
    // Below any address that fits as far without one: `/` is the start page before `[...slug]` (P276).
    if (isCatchAll(segment)) return score - 0.5;
    const part = written[index];
    // An optional parameter at the end may be left out.
    if (part === undefined) return segment.endsWith('?') && index === pattern.length - 1 ? score : undefined;
    if (isParam(segment)) {
      score += 1;
      continue;
    }
    if (part.includes('\u0000') || part !== segment) return undefined;
    score += 3;
  }
  return written.length === pattern.length ? score : undefined;
};

/** How many leading directories two repo-relative files share. */
const sharedDirectories = (a: string, b: string): number => {
  const left = a.split('/').slice(0, -1);
  const right = b.split('/').slice(0, -1);
  let shared = 0;
  while (shared < left.length && left[shared] === right[shared]) shared += 1;
  return shared;
};

/**
 * The page a path lands on: the best fit, or a row where none fits or two fit
 * as well. Two pages that fit as well in two applications one service holds
 * (`apps/a/app/login`, `apps/b/app/login`) are told apart by the navigating
 * file: the page nearest it, by the directories they share, is its own
 * application's (P276).
 */
const byPath = (all: readonly Page[], path: string, from: string): Landing => {
  // An address that starts with a value read at run time may start with a host: which application it is in is not read.
  if (path.startsWith('${')) return { kind: 'unresolved', why: 'dynamic', written: path };
  const pages = ownPages(all, from);
  // A value glued to the end of the last segment (`/login${query}`) is the query, not the page.
  const trimmed = path.replace(/([^/$}])\$\{[^}]*\}$/, '$1');
  const written = segmentsOf(trimmed.replace(/\$\{[^}]*\}/g, '\u0000'));
  const fits = pages.flatMap((page): Array<{ page: Page; fit: number; localized?: true }> => {
    const fit = fitOf(written, page.route);
    if (page.localePrefix === undefined) return fit === undefined ? [] : [{ page, fit }];
    return localizedFits(page, written, fit);
  });
  const best = Math.max(...fits.map((each) => each.fit));
  let top = fits.filter((each) => each.fit === best);
  // One page fits both as written and with the locale put in front: as written.
  top = top.filter((each) => each.localized !== true || !top.some((other) => other.page === each.page && other.localized !== true));
  // One component shown at two addresses that fit as well is still one page.
  if (top.length > 1 && top.every((each) => each.page.fn === top[0]?.page.fn)) top = top.slice(0, 1);
  // A page placed through a branch nothing decides gives way to one placed outright (P288).
  if (top.length > 1 && top.some((each) => each.page.guessed !== true)) top = top.filter((each) => each.page.guessed !== true);
  // A screen that holds routes of its own (`<Route path="/settings" component={SettingsRoutes} />`) gives way to the page they place there (P291).
  if (top.length > 1) {
    const inner = top.filter((each) => !top.some((other) => other.page.within?.includes(each.page.fn.id) === true));
    if (inner.length > 0) top = inner;
  }
  if (top.length > 1) {
    const nearest = Math.max(...top.map((each) => sharedDirectories(each.page.file, from)));
    top = top.filter((each) => sharedDirectories(each.page.file, from) === nearest);
  }
  const shown = path.replace(/\u0000/g, '${…}');
  const landed = (each: { page: Page; localized?: true }, guessed: boolean): PageLanding => ({
    kind: 'page',
    page: each.page,
    by: 'path',
    written: shown,
    ...(guessed ? { guessed: true as const } : {}),
    ...(each.localized === true && each.page.localePrefix !== undefined ? { localePrefix: each.page.localePrefix } : {}),
  });
  if (top.length === 0) return { kind: 'unresolved', why: 'missing', written: shown };
  // Pages each placed under its own side of one condition: the build's choices, each a branch (P291).
  if (top.length > 1 && exclusive(top.map((each) => each.page))) return { kind: 'branches', landings: top.map((each) => landed(each, true)) };
  if (top.length > 1) return { kind: 'unresolved', why: 'ambiguous', written: shown };
  return landed(top[0] as { page: Page; localized?: true }, false);
};

/** A segment that is a locale: `fr`, `pt-BR`, `zh-Hant`. */
const LOCALE_TAG = /^[a-z]{2}(?:[-_][A-Za-z]{2,4})?$/;

/**
 * How a page under a locale segment a middleware adds (`app/[locale]/search`)
 * fits a written address (P291): an address that starts with a value or a
 * locale is written with the prefix, and fits as written; one that starts
 * with anything else is written without it, and the middleware puts it in
 * front - it fits the page's address past the prefix, `localized`. A segment
 * that may be either (`/fr`) is tried both ways.
 */
const localizedFits = (page: Page, written: readonly string[], asWritten: number | undefined): Array<{ page: Page; fit: number; localized?: true }> => {
  const first = written[0];
  const prefixed = first !== undefined && first.includes('\u0000');
  const out: Array<{ page: Page; fit: number; localized?: true }> = [];
  if (asWritten !== undefined && (prefixed || (first !== undefined && LOCALE_TAG.test(first)))) out.push({ page, fit: asWritten });
  if (!prefixed) {
    const rest = page.route.split('/').filter((segment) => segment !== '').slice(1).join('/');
    const fit = fitOf(written, `/${rest}`);
    // Below the same fit as written, so a page placed without the prefix answers first.
    if (fit !== undefined) out.push({ page, fit: fit - 0.25, localized: true });
  }
  return out;
};

/** Each service's application roots: a file's nearest directory holding a manifest, below the repository's. */
const ROOTS = new WeakMap<readonly Page[], { readonly repoDir: string; readonly roots: Map<string, string> }>();

/** The directory of the nearest manifest above a repo-relative file, `''` for the repository's own. */
const rootOf = (repoDir: string, roots: Map<string, string>, file: string): string => {
  const directory = file.split('/').slice(0, -1).join('/');
  const known = roots.get(directory);
  if (known !== undefined) return known;
  const found = directory === '' || existsSync(join(repoDir, directory, 'package.json')) ? directory : rootOf(repoDir, roots, directory);
  roots.set(directory, found);
  return found;
};

/**
 * The pages a navigation written in a file can show: those of the
 * application the file is in - the nearest directory holding a manifest -
 * where that application has pages, every page otherwise (a library of the
 * workspace navigates to the pages of whichever application renders it). A
 * router shows its own application's pages only, so in a service holding
 * many applications a page of a sibling is no candidate (P288).
 */
const ownPages = (pages: readonly Page[], from: string): readonly Page[] => {
  const scoped = ROOTS.get(pages);
  if (scoped === undefined) return pages;
  const root = rootOf(scoped.repoDir, scoped.roots, from);
  const own = pages.filter((page) => rootOf(scoped.repoDir, scoped.roots, page.file) === root);  return own.length > 0 ? own : pages;
};

/** The text of an address written as a literal or a template, its `${…}` holes kept. */
const addressText = (node: TsNode): string | undefined => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isTemplateExpression(node)) {
    return node.getHead().getLiteralText() + node.getTemplateSpans().map((span) => `\${${span.getExpression().getText()}}${span.getLiteral().getLiteralText()}`).join('');
  }
  return undefined;
};

const propertyValue = (object: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/** Where an address read as text lands, from a branch nothing decides where it was read through one. */
const pathLanding = (pages: readonly Page[], text: string, from: string, external: boolean, guessed: boolean): Landing => {
  if (EXTERNAL.test(text) || (external && !text.startsWith('/'))) return { kind: 'external', written: text };
  const landing = byPath(pages, text, from);
  return landing.kind === 'page' && (guessed || landing.page.guessed === true) ? { ...landing, guessed: true } : landing;
};

/**
 * Where `navigateTo(to, options)` lands: one landing per address the value
 * spells, a path a function of the repository hands back read through it
 * (`push(adminPath('teams'))`), one per branch nothing decides (P288).
 */
const landingsOf = (pages: readonly Page[], to: TsNode | undefined, options: TsNode | undefined, from: string): Landing[] => {
  const external = options !== undefined && propertyValue(options, 'external')?.getText() === 'true';
  if (to === undefined) return [{ kind: 'unresolved', why: 'dynamic', written: '' }];
  const text = addressText(to);
  if (text !== undefined && !Node.isTemplateExpression(to)) return [pathLanding(pages, text, from, external, false)];
  const spelled = Node.isObjectLiteralExpression(to) ? undefined : spelledPaths(to);
  if (spelled !== undefined) return branchLandings(spelled.map((each) => ({ landing: pathLanding(pages, each.text, from, external, each.guessed === true), guessed: each.guessed === true })));
  if (Node.isObjectLiteralExpression(to)) {
    const name = propertyValue(to, 'name');
    const pathname = propertyValue(to, 'path') ?? propertyValue(to, 'pathname');
    const read = name === undefined && pathname !== undefined && addressText(pathname) === undefined ? spelledPaths(pathname) : undefined;
    if (read !== undefined) return branchLandings(read.map((each) => ({ landing: pathLanding(pages, each.text, from, false, each.guessed === true), guessed: each.guessed === true })));
  }
  return [landingOf(pages, to, options, from)];
};

/**
 * The landings of a navigation's branches: where one branch nothing decides
 * lands on a page, another that lands nowhere is the build's other choice and
 * says nothing of its own (P288).
 */
const branchLandings = (read: ReadonlyArray<{ readonly landing: Landing; readonly guessed: boolean }>): Landing[] =>
  read.some((each) => each.landing.kind === 'page' || each.landing.kind === 'branches')
    ? read.filter((each) => each.landing.kind === 'page' || each.landing.kind === 'branches' || !each.guessed).map((each) => each.landing)
    : read.map((each) => each.landing);

/** Where `navigateTo(to, options)` lands, read as written. */
const landingOf = (pages: readonly Page[], to: TsNode | undefined, options: TsNode | undefined, from: string): Landing => {
  const external = options !== undefined && propertyValue(options, 'external')?.getText() === 'true';
  if (to === undefined) return { kind: 'unresolved', why: 'dynamic', written: '' };
  const text = addressText(to);
  if (text !== undefined) return EXTERNAL.test(text) || (external && !text.startsWith('/')) ? { kind: 'external', written: text } : byPath(pages, text, from);
  if (Node.isObjectLiteralExpression(to)) {
    const name = propertyValue(to, 'name');
    const path = propertyValue(to, 'path');
    const named = name === undefined ? undefined : addressText(name);
    if (named !== undefined && !named.includes('${')) {
      const found = pages.filter((page) => page.name === named);
      return found.length === 1 ? { kind: 'page', page: found[0] as Page, by: 'name', written: named } : { kind: 'unresolved', why: found.length === 0 ? 'missing' : 'ambiguous', written: named };
    }
    // `{ path }` for Vue Router, `{ pathname, query }` for Next's router and link (P276).
    const pathname = path ?? propertyValue(to, 'pathname');
    const pathText = pathname === undefined ? undefined : addressText(pathname);
    if (name === undefined && pathText !== undefined) return EXTERNAL.test(pathText) ? { kind: 'external', written: pathText } : byPath(pages, pathText, from);
  }
  return { kind: 'unresolved', why: 'dynamic', written: to.getText().replace(/\s+/g, ' ').slice(0, 60) };
};

/** A step back or forward through the history, `navigate(-1)`: no page is named, and nothing is said. */
const isHistoryStep = (to: TsNode | undefined): boolean =>
  to !== undefined && (Node.isNumericLiteral(to) || (Node.isPrefixUnaryExpression(to) && Node.isNumericLiteral(to.getOperand())));

/** The module a name is imported from and the name it is exported under (`default` for a default import). */
const importOf = (name: TsNode): { readonly module: string; readonly name: string } | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isImportSpecifier(declaration)) return { module: declaration.getImportDeclaration().getModuleSpecifierValue(), name: declaration.getName() };
    if (Node.isImportClause(declaration)) {
      const imported = declaration.getParent();
      return Node.isImportDeclaration(imported) ? { module: imported.getModuleSpecifierValue(), name: 'default' } : undefined;
    }
  }
  return undefined;
};

/** The modules whose makers hand back a locale router's own navigation: next-intl's `createNavigation(routing)` (P291). */
const LOCALE_NAVIGATION_MAKERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['createNavigation', new Set(['next-intl/navigation'])],
  ['createSharedPathnamesNavigation', new Set(['next-intl/navigation'])],
  ['createLocalizedPathnamesNavigation', new Set(['next-intl/navigation'])],
]);

/**
 * The name a locale router's navigation hands a name out as, where the name
 * is one: `export const { Link, redirect, useRouter } = createNavigation(routing)`
 * in a module of the application, imported where it navigates under any name
 * (P291). The address is written without the locale, which the helper puts
 * in front.
 */
const localeNavigationName = (name: TsNode): string | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const symbol = name.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (!Node.isBindingElement(declaration)) continue;
    const holder = declaration.getParent()?.getParent();
    const made = holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getInitializer() : undefined;
    if (made === undefined || !Node.isCallExpression(bare(made))) continue;
    const found = importOf((bare(made) as CallExpression).getExpression());
    if (found === undefined || LOCALE_NAVIGATION_MAKERS.get(found.name)?.has(found.module) !== true) continue;
    return declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
  }
  return undefined;
};

/** Whether a name is one a framework exports under that name from one of these modules. */
const importedFrom = (name: TsNode, exported: string, modules: ReadonlySet<string>): boolean => {
  const found = importOf(name);
  return found !== undefined && found.name === exported && modules.has(found.module);
};

/** The routers whose hook hands back a router: `useRouter()` (P276). */
const ROUTER_HOOK_MODULES: ReadonlySet<string> = new Set(['next/router', 'next/navigation', 'vue-router']);
/** React Router before version 6, whose `useHistory()` hands back the history its `push` and `replace` navigate. */
const HISTORY_HOOK_MODULES: ReadonlySet<string> = new Set(['react-router', 'react-router-dom']);
/** The routers made by a call of their own: Vue Router's `createRouter`, React Router's data routers. */
const ROUTER_MAKERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['createRouter', new Set(['vue-router'])],
  ['createBrowserRouter', new Set(['react-router', 'react-router-dom'])],
  ['createHashRouter', new Set(['react-router', 'react-router-dom'])],
  ['createMemoryRouter', new Set(['react-router', 'react-router-dom'])],
  // The history React Router before version 6 is handed, made once and imported where a component navigates outside the router (P288).
  ['createBrowserHistory', new Set(['history'])],
  ['createHashHistory', new Set(['history'])],
  ['createMemoryHistory', new Set(['history'])],
]);
/** React Router's `useNavigate()`, which hands back the function that navigates. */
const NAVIGATE_HOOK_MODULES: ReadonlySet<string> = new Set(['react-router', 'react-router-dom', '@remix-run/react']);
/** The `redirect(...)` a loader, an action or a server component returns or throws. */
const REDIRECT_MODULES: ReadonlySet<string> = new Set(['next/navigation', 'react-router', 'react-router-dom', '@remix-run/node', '@remix-run/react', '@remix-run/server-runtime', '@sveltejs/kit']);
/** The components a JSX link is written with: React Router's `to`, Next's `href`. */
const LINK_COMPONENTS: ReadonlyArray<{ readonly modules: ReadonlySet<string>; readonly names: ReadonlySet<string>; readonly attribute: string; readonly redirects?: true }> = [
  { modules: new Set(['react-router', 'react-router-dom', '@remix-run/react']), names: new Set(['Link', 'NavLink']), attribute: 'to' },
  // React Router's `<Navigate to>`, and `<Redirect to>` before version 6: shown, they navigate in place of the page.
  { modules: new Set(['react-router', 'react-router-dom']), names: new Set(['Navigate', 'Redirect']), attribute: 'to', redirects: true },
  { modules: new Set(['next/link']), names: new Set(['default']), attribute: 'href' },
];
/** The methods of a router that navigate, and whether each replaces the entry in the history. */
const ROUTER_METHODS: ReadonlyMap<string, boolean> = new Map([
  ['push', false],
  ['replace', true],
  ['navigate', false],
]);

/** The value a name holds where it is a `const` written with one, through an import of the module that writes it. */
const constValue = (name: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const symbol = name.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const value = declaration.getInitializer();
  return value === undefined ? undefined : bare(value);
};

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value)) value = value.getExpression();
  return value;
};

/** Whether a call hands back a router: `useRouter()`, `createRouter(...)`, `createBrowserRouter(...)`. */
const makesRouter = (call: TsNode, nuxt: boolean): boolean => {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (importedFrom(callee, 'useRouter', ROUTER_HOOK_MODULES) || importedFrom(callee, 'useHistory', HISTORY_HOOK_MODULES)) return true;
  if (localeNavigationName(callee) === 'useRouter') return true;
  if (nuxt && isNuxts(callee, 'useRouter')) return true;
  const found = importOf(callee);
  return found !== undefined && ROUTER_MAKERS.get(found.name)?.has(found.module) === true;
};

/**
 * Whether a value is a router: one a hook or a maker handed back, held in a
 * `const` here or in the module it is imported from, Next's `Router` (the
 * default export of `next/router`), or a Vue component's `this.$router`.
 */
const isRouter = (value: TsNode, nuxt: boolean): boolean => {
  const held = bare(value);
  if (Node.isPropertyAccessExpression(held)) return held.getName() === '$router' && Node.isThisExpression(held.getExpression());
  if (Node.isCallExpression(held)) return makesRouter(held, nuxt);
  if (!Node.isIdentifier(held)) return false;
  if (importedFrom(held, 'default', new Set(['next/router']))) return true;
  const made = constValue(held);
  return made !== undefined && makesRouter(made, nuxt);
};

/** One navigation a call makes: where to, with what options, and how. */
interface CallNavigation {
  readonly to: TsNode | undefined;
  readonly options?: TsNode;
  readonly replace?: boolean;
  readonly redirects?: boolean;
}

/**
 * What a call navigates to, when it is a framework's navigation: Nuxt's
 * `navigateTo` (and `abortNavigation`), SvelteKit's `goto`, a `redirect(...)`
 * of Next, React Router, Remix or SvelteKit, React Router's `navigate` from
 * `useNavigate()`, and `push` / `replace` / `navigate` on a router - Vue
 * Router's, Next's, React Router's data router - however it was got, `push`
 * and `replace` taken out of `useRouter()` included (P276).
 */
const navigationOf = (call: CallExpression, nuxt: boolean): CallNavigation | 'abort' | undefined => {
  const callee = call.getExpression();
  const [first, second] = call.getArguments();
  const optionTrue = (options: TsNode | undefined, key: string): boolean => options !== undefined && propertyValue(options, key)?.getText() === 'true';
  if (Node.isIdentifier(callee)) {
    if (nuxt && isNuxts(callee, 'navigateTo')) return { to: first, ...(second === undefined ? {} : { options: second }), replace: optionTrue(second, 'replace') };
    if (nuxt && isNuxts(callee, 'abortNavigation')) return 'abort';
    if (importedFrom(callee, 'goto', new Set(['$app/navigation']))) return { to: first, replace: optionTrue(second, 'replaceState') };
    if (importedFrom(callee, 'redirect', REDIRECT_MODULES)) {
      // SvelteKit's is `redirect(status, location)`; the others take the address first.
      const kit = importOf(callee)?.module === '@sveltejs/kit';
      return { to: kit ? second : first, redirects: true };
    }
    const localized = localeNavigationName(callee);
    if (localized === 'redirect' || localized === 'permanentRedirect') return { to: first, redirects: true };
    const held = constValue(callee);
    if (held !== undefined && Node.isCallExpression(held) && importedFrom(held.getExpression(), 'useNavigate', NAVIGATE_HOOK_MODULES)) {
      return { to: first, replace: optionTrue(second, 'replace') };
    }
    // `const { push, replace } = useRouter()`, then `push('/x')`.
    const declaration = callee.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isBindingElement(declaration)) {
      const method = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      const pattern = declaration.getParent();
      const holder = pattern?.getParent();
      const value = holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getInitializer() : undefined;
      if (ROUTER_METHODS.has(method) && value !== undefined && isRouter(value, nuxt)) return { to: first, replace: ROUTER_METHODS.get(method) === true };
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const replaces = ROUTER_METHODS.get(callee.getName());
  if (replaces === undefined || !isRouter(callee.getExpression(), nuxt)) return undefined;
  return { to: first, replace: replaces || optionTrue(second, 'replace') };
};

/** The component a JSX element is a link of: the attribute its address is written in, and whether it redirects. */
const linkOf = (tag: TsNode): { readonly attribute: string; readonly redirects?: true } | undefined => {
  // A locale router's own `<Link href>` (P291).
  if (localeNavigationName(tag) === 'Link') return { attribute: 'href' };
  const found = importOf(tag);
  if (found === undefined) return undefined;
  return LINK_COMPONENTS.find((link) => link.modules.has(found.module) && link.names.has(found.name));
};

/** Whether a callee is Nuxt's own function of that name: auto-imported, or imported from Nuxt. */
const isNuxts = (callee: TsNode, name: string): boolean => {
  if (!Node.isIdentifier(callee) || callee.getText() !== name) return false;
  const declarations = callee.getSymbol()?.getDeclarations() ?? [];
  return declarations.every((declaration) => {
    if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) return true;
    const imported = declaration.getFirstAncestor((each) => Node.isImportDeclaration(each));
    return imported !== undefined && Node.isImportDeclaration(imported) && NUXT_MODULES.has(imported.getModuleSpecifierValue());
  });
};

/** The function of this reading a call is written in, the nearest first. */
const ownerOf = (ctx: ReactExtractContext, call: TsNode): IndexedFunction | undefined => {
  for (let at = call.getParent(); at !== undefined && !Node.isSourceFile(at); at = at.getParent()) {
    if (Node.isFunctionLikeDeclaration(at) || Node.isVariableDeclaration(at) || Node.isPropertyAssignment(at)) {
      const indexed = ctx.functions.get(at as never);
      if (indexed !== undefined) return indexed;
    }
  }
  return undefined;
};

const navigationRow = (ctx: ReactExtractContext, file: string, line: number, symbol: string, landing: Exclude<Landing, { kind: 'page' | 'branches' }>, unplaced = 0): void => {
  if (landing.kind === 'external') {
    ctx.report({
      file,
      line,
      reason: 'navigation-external',
      level: 'info',
      symbol: `${symbol} navigates to ${landing.written}`,
      message: `${file} navigates to ${landing.written}, outside the application, so no page of it is joined`,
      hint: 'Nothing to do: an address with a host, or one navigated to with `{ external: true }`, leaves the application.',
      meta: { cause: 'navigation-external', navigates: landing.written },
    });
    return;
  }
  // No page placed, where some of the application's routes were written in a way not read: the page may be one of those (P276).
  const why = landing.why === 'missing' && unplaced > 0 ? 'unplaced' : landing.why;
  ctx.report({
    file,
    line,
    reason: 'navigation-unresolved',
    level: why === 'dynamic' || why === 'unplaced' ? 'info' : 'action',
    symbol: `${symbol} navigates to ${landing.written}`,
    message:
      why === 'missing'
        ? `${file} navigates to ${landing.written}, which no page of the application shows, so the navigation joins nothing`
        : why === 'unplaced'
          ? `${file} navigates to ${landing.written}, which no page this reading placed shows; ${unplaced} route${unplaced === 1 ? '' : 's'} of the application ${unplaced === 1 ? 'is' : 'are'} written in a way not read, and it may be one of them`
          : why === 'ambiguous'
            ? `${file} navigates to ${landing.written}, which two pages of the application fit as well, so which one it shows is not said`
            : `${file} navigates to an address written as code (${landing.written}), so which page it shows is not read`,
    hint:
      why === 'missing'
        ? 'Correct the address or the name, or add the page under `pages/`.'
        : why === 'unplaced'
          ? 'Write the route\'s path as a literal and its screen as a component of the repository, so the page is placed.'
          : why === 'ambiguous'
            ? 'Rename one of the two pages, so one address is one page.'
            : 'Write the address as a literal or a template of one, or as `{ name: \'...\' }` with a literal name.',
    meta: { cause: 'navigation-unresolved', why, navigates: landing.written },
  });
};

/** One script to read for navigations: its file, and the component it belongs to where it is one's. */
export interface NavigatingScript {
  readonly file: string;
  readonly script: SourceFile;
  readonly component?: IndexedFunction;
  /** A component's markup, read for its links. */
  readonly markup?: string;
}

/** Nuxt's pages: each page file at its address, named as Nuxt names it or as its `definePageMeta` writes. */
export const nuxtPages = (
  routes: ReadonlyMap<string, string>,
  byFile: ReadonlyMap<string, IndexedFunction>,
  scriptOf: (file: string) => SourceFile | undefined,
): Page[] =>
  [...routes].flatMap(([file, route]) => {
    const fn = byFile.get(file);
    if (fn === undefined) return [];
    const name = declaredName(scriptOf(file)) ?? pageNameOf(file);
    return [{ file, route, fn, ...(name === undefined ? {} : { name }) }];
  });

/** Words a file must hold for any of its calls or elements to be a navigation, so most files are passed over unread. */
const MAY_NAVIGATE = /navigateTo|abortNavigation|\$router|useRouter|useNavigate|useHistory|\bNavigate\b|\bRedirect\b|\bgoto\b|\bredirect\b|createRouter|create(?:Browser|Hash|Memory)Router|next\/link|next\/router|\bLink\b|\.(?:push|replace|navigate)\(/;

export const drawNavigations = (
  ctx: ReactExtractContext,
  pages: readonly Page[],
  scripts: readonly NavigatingScript[],
  /** The function a route middleware file runs, adopted so a call in it has an owner. */
  middlewareOf: (file: string) => IndexedFunction | undefined,
  edge: DrawEdge,
  /** Whether the application is Nuxt's, whose `navigateTo`, `useRouter` and `<NuxtLink>` are auto-imported. */
  nuxt: boolean,
  /** How many of the application's routes are written in a way not read, so a page may exist that was not placed. */
  unplaced = 0,
): void => {
  // Every navigation from one function to one page, drawn as one edge once all are read (P291).
  const landed = new Map<string, { from: IndexedFunction; to: IndexedFunction; each: Array<{ file: string; line: number; meta: Record<string, unknown> }> }>();
  const land = (from: IndexedFunction, file: string, line: number, landing: Landing, extra: Record<string, unknown>): void => {
    if (landing.kind === 'branches') {
      for (const each of landing.landings) land(from, file, line, each, extra);
      return;
    }
    if (landing.kind !== 'page') {
      navigationRow(ctx, file, line, from.name, landing, unplaced);
      return;
    }
    if (from.id === landing.page.fn.id) return;
    if (landing.localePrefix !== undefined) localizedRow(ctx, file, line, from.name, landing);
    const key = `${from.id}\u0000${landing.page.fn.id}`;
    const pair = landed.get(key) ?? { from, to: landing.page.fn, each: [] };
    landed.set(key, pair);
    pair.each.push({
      file,
      line,
      meta: {
        [NAVIGATES_META]: landing.written,
        route: landing.page.route,
        page: landing.page.file,
        ...(landing.by === 'name' ? { byName: true } : {}),
        ...(landing.guessed === true ? { branch: true } : {}),
        ...(landing.localePrefix === undefined ? {} : { localePrefix: landing.localePrefix }),
        ...extra,
      },
    });
  };
  const linkTags = nuxt ? LINK_TAGS : VUE_ROUTER_LINK_TAGS;
  const kit = hasDependency(ctx.pkg, '@sveltejs/kit');
  // A router shows its own application's pages: a sibling's in a service of many is no candidate (P288). Nuxt's layers lend pages across.
  if (!nuxt) ROOTS.set(pages, { repoDir: ctx.repoDir, roots: new Map() });

  for (const { file, script, component, markup } of scripts) {
    if (MAY_NAVIGATE.test(script.getFullText())) {
      const middleware = middlewareOf(file);
      script.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const navigation = navigationOf(node, nuxt);
          if (navigation === undefined) return;
          const owner = ownerOf(ctx, node) ?? middleware ?? component;
          if (owner === undefined) return;
          const line = startLineOf(node);
          if (navigation === 'abort') {
            // The navigation this runs in shows nothing (P265).
            ctx.ensureFunctionNode(owner.fn, { abortsNavigation: true });
            return;
          }
          if (isHistoryStep(navigation.to)) return;
          // `return navigateTo(...)` in a route middleware: the navigation it runs in goes there instead.
          const parent = node.getParent();
          const returned = middleware !== undefined && parent !== undefined && (Node.isReturnStatement(parent) || Node.isArrowFunction(parent));
          const redirects = navigation.redirects === true || returned;
          for (const landing of landingsOf(pages, navigation.to, navigation.options, file)) {
            land(owner, file, line, landing, {
              ...(navigation.replace === true ? { replace: true } : {}),
              ...(redirects ? { redirects: true } : {}),
            });
          }
          return;
        }
        // `<Link to="/orders">`, `<NavLink to>`, Next's `<Link href>` (P276).
        if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) return;
        const tag = node.getTagNameNode();
        const link = linkOf(tag);
        if (link === undefined) return;
        const { attribute } = link;
        const written = node.getAttributes().find((each) => Node.isJsxAttribute(each) && each.getNameNode().getText() === attribute);
        if (written === undefined || !Node.isJsxAttribute(written)) return;
        const owner = ownerOf(ctx, node) ?? component;
        if (owner === undefined) return;
        const initializer = written.getInitializer();
        const value = initializer !== undefined && Node.isJsxExpression(initializer) ? initializer.getExpression() : initializer;
        const replace = node.getAttributes().some((each) => Node.isJsxAttribute(each) && each.getNameNode().getText() === 'replace' && (each.getInitializer() === undefined || each.getInitializer()?.getText() === '{true}'));
        for (const landing of landingsOf(pages, value, undefined, file)) {
          land(owner, file, startLineOf(node), landing, { link: tag.getText(), ...(replace ? { replace: true } : {}), ...(link.redirects === true ? { redirects: true } : {}) });
        }
      });
    }
    if (component === undefined || markup === undefined) continue;
    const svelte = file.endsWith('.svelte');
    // `@click="router.push('/x')"`, `on:click={() => goto('/x')}`: a navigation in the markup's own handler (P288).
    for (const event of svelte ? svelteMarkupEvents(markup) : vueTemplateEvents(markup)) {
      for (const call of templateCalls(event.source)) {
        const how = templateNavigation(script, call.callee, nuxt);
        const [first] = call.args;
        if (how === undefined || first === undefined || /^-?\d+$/.test(first.trim())) continue;
        land(component, file, event.line, boundLanding(pages, first, file), { handler: event.attribute, ...(how.replace ? { replace: true } : {}) });
      }
    }
    if (svelte) {
      // SvelteKit's router takes over a plain `<a href>` to a page of the application (P288).
      if (!kit) continue;
      for (const tag of svelteMarkupTags(markup)) {
        if (tag.name !== 'a') continue;
        const href = tag.attributes.get('href');
        if (typeof href !== 'string') continue;
        const landing = svelteHrefLanding(pages, href.trim(), file);
        if (landing !== undefined) land(component, file, tag.line, landing, { link: 'a' });
      }
      continue;
    }
    for (const tag of vueTemplateTags(markup)) {
      if (!linkTags.has(tag.name)) continue;
      const literal = tag.attributes.get('to');
      const bound = tag.attributes.get(':to') ?? tag.attributes.get('v-bind:to');
      const external = tag.attributes.has('external');
      const landing: Landing | undefined =
        typeof literal === 'string'
          ? EXTERNAL.test(literal) || external
            ? { kind: 'external', written: literal }
            : byPath(pages, literal, file)
          : typeof bound === 'string'
            ? boundLanding(pages, bound, file)
            : undefined;
      if (landing !== undefined) land(component, file, tag.line, landing, { link: tag.name });
    }
  }

  // One edge per function and page (P291): the navigation written outright
  // where there is one, so a guess elsewhere does not weaken it, and every
  // other address written to the same page in `meta.alsoNavigates`.
  for (const { from, to, each } of landed.values()) {
    const primary = each.find((one) => navigationConfidence(one.meta) === 'static') ?? (each[0] as (typeof each)[number]);
    const written = primary.meta[NAVIGATES_META];
    const also = [...new Set(each.map((one) => one.meta[NAVIGATES_META]).filter((other): other is string => typeof other === 'string' && other !== written))].sort();
    edge(from, to, primary.file, primary.line, { ...primary.meta, ...(also.length === 0 ? {} : { alsoNavigates: also }) });
  }
};

/**
 * The note beside a navigation joined across a locale prefix (P291): the
 * address is written without the locale, the application's middleware or
 * routing configuration puts it in front, and the page is the one under the
 * locale segment.
 */
const localizedRow = (ctx: ReactExtractContext, file: string, line: number, symbol: string, landing: PageLanding): void => {
  ctx.report({
    file,
    line,
    reason: 'navigation-locale-prefixed',
    level: 'info',
    symbol: `${symbol} navigates to ${landing.written}`,
    message: `${file} navigates to ${landing.written}, written without the locale the application's middleware puts in front, so it is joined to ${landing.page.route}, the page under ${landing.localePrefix ?? 'the locale segment'}`,
    hint: 'Nothing to do: the middleware or the routing configuration that adds the locale is what places the page; the join is heuristic.',
    meta: { cause: 'navigation-locale-prefixed', navigates: landing.written, route: landing.page.route },
  });
};

/** What `:to="..."` names: a quoted address, a template of one, `{ name: '...' }`, or code. */
const boundLanding = (pages: readonly Page[], bound: string, from: string): Landing => {
  const value = bound.trim();
  const template = /^`([^`]*)`$/.exec(value);
  if (template !== null && (template[1] as string).includes('${')) {
    const text = template[1] as string;
    return EXTERNAL.test(text) ? { kind: 'external', written: text } : byPath(pages, text, from);
  }
  const quoted = /^(['"`])([^'"`$]*)\1$/.exec(value);
  if (quoted !== null) {
    const text = quoted[2] as string;
    return EXTERNAL.test(text) ? { kind: 'external', written: text } : byPath(pages, text, from);
  }
  const named = /^\{\s*name\s*:\s*(['"])([^'"]+)\1\s*(?:,[\s\S]*)?\}$/.exec(value);
  if (named !== null) {
    const name = named[2] as string;
    const found = pages.filter((page) => page.name === name);
    return found.length === 1 ? { kind: 'page', page: found[0] as Page, by: 'name', written: name } : { kind: 'unresolved', why: found.length === 0 ? 'missing' : 'ambiguous', written: name };
  }
  return { kind: 'unresolved', why: 'dynamic', written: value.replace(/\s+/g, ' ').slice(0, 60) };
};

/** A call written in a markup handler: what is called, as written, and its arguments' text. */
interface TemplateCall {
  readonly callee: string;
  readonly args: readonly string[];
}

/** The arguments of a call whose `(` is at `open`, split at their own commas, or nothing where the text ends first. */
const argumentsAt = (source: string, open: number): string[] | undefined => {
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = open + 1;
  for (let at = open; at < source.length; at += 1) {
    const char = source[at] as string;
    if (quote !== undefined) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        const last = source.slice(start, at).trim();
        if (last !== '') args.push(last);
        return args;
      }
    } else if (char === ',' && depth === 1) {
      args.push(source.slice(start, at).trim());
      start = at + 1;
    }
  }
  return undefined;
};

/** Every call a markup handler's code makes: `router.push('/x')`, `$router.replace(...)`, `goto('/x')`. */
const templateCalls = (source: string): TemplateCall[] => {
  const calls: TemplateCall[] = [];
  for (const match of source.matchAll(/(?<![\w$.])((?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*\(/g)) {
    const args = argumentsAt(source, (match.index as number) + match[0].length - 1);
    if (args !== undefined) calls.push({ callee: (match[1] as string).replace(/\s+/g, ''), args });
  }
  return calls;
};

/** The declaration a name has in a component's script: a `const`, a name taken out of one, or an import. */
const declaredIn = (script: SourceFile, name: string): TsNode | undefined => {
  let found: TsNode | undefined;
  script.forEachDescendant((node, traversal) => {
    if (!Node.isIdentifier(node) || node.getText() !== name) return;
    const parent = node.getParent();
    if (parent !== undefined && (Node.isVariableDeclaration(parent) || Node.isBindingElement(parent) || Node.isImportSpecifier(parent)) && parent.getNameNode() === node) {
      found = parent;
      traversal.stop();
    }
    if (parent !== undefined && Node.isImportSpecifier(parent) && parent.getAliasNode() === node) {
      found = parent;
      traversal.stop();
    }
  });
  return found;
};

/**
 * Whether a call written in a markup handler navigates, and how: `push` and
 * `replace` on `$router` or on a router the script holds, Nuxt's
 * `navigateTo`, SvelteKit's `goto`, and `push` / `replace` taken out of a
 * router (P288).
 */
const templateNavigation = (script: SourceFile, callee: string, nuxt: boolean): { readonly replace: boolean } | undefined => {
  const parts = callee.split('.');
  const method = parts.at(-1) as string;
  if (parts.length > 1) {
    const replace = ROUTER_METHODS.get(method);
    if (replace === undefined) return undefined;
    const receiver = parts.slice(0, -1).join('.');
    if (receiver === '$router' || receiver === 'this.$router') return { replace };
    if (parts.length !== 2) return undefined;
    const held = declaredIn(script, receiver);
    const value = held !== undefined && Node.isVariableDeclaration(held) ? held.getInitializer() : undefined;
    return value !== undefined && isRouter(value, nuxt) ? { replace } : undefined;
  }
  if (nuxt && method === 'navigateTo' && declaredIn(script, method) === undefined) return { replace: false };
  const declaration = declaredIn(script, method);
  if (declaration === undefined) return undefined;
  if (Node.isImportSpecifier(declaration)) {
    const module = declaration.getImportDeclaration().getModuleSpecifierValue();
    if (declaration.getName() === 'goto' && module === '$app/navigation') return { replace: false };
    if (declaration.getName() === 'navigateTo' && NUXT_MODULES.has(module)) return { replace: false };
    return undefined;
  }
  if (Node.isBindingElement(declaration)) {
    const taken = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
    const holder = declaration.getParent()?.getParent();
    const value = holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getInitializer() : undefined;
    const replace = ROUTER_METHODS.get(taken);
    return replace !== undefined && value !== undefined && isRouter(value, nuxt) ? { replace } : undefined;
  }
  return undefined;
};

/**
 * Where a SvelteKit `<a href>` lands: a literal address, one with values
 * written in braces (`/orders/{order.id}`), or code in braces; a fragment
 * or an empty `href` names no page and says nothing.
 */
const svelteHrefLanding = (pages: readonly Page[], href: string, from: string): Landing | undefined => {
  if (href === '' || href.startsWith('#')) return undefined;
  const whole = /^\{([^{}]*)\}$/.exec(href);
  if (whole !== null) return boundLanding(pages, whole[1] as string, from);
  const text = href.replace(/\{([^{}]*)\}/g, (_match, inner: string) => `\${${inner.trim()}}`);
  if (EXTERNAL.test(text)) return { kind: 'external', written: text };
  // A relative address is the browser's to resolve against the page it is on, which is not read here.
  if (!text.startsWith('/')) return { kind: 'unresolved', why: 'dynamic', written: text };
  return byPath(pages, text, from);
};
