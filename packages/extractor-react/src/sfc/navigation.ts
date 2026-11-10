import { NAVIGATES_META, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { vueTemplateTags } from './events.js';

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
}

/** Where a navigation lands, as the router decides it. */
type Landing =
  | { readonly kind: 'page'; readonly page: Page; readonly by: 'path' | 'name'; readonly written: string }
  | { readonly kind: 'external'; readonly written: string }
  | { readonly kind: 'unresolved'; readonly why: 'missing' | 'dynamic' | 'ambiguous'; readonly written: string };

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
const byPath = (pages: readonly Page[], path: string, from: string): Landing => {
  // An address that starts with a value read at run time may start with a host: which application it is in is not read.
  if (path.startsWith('${')) return { kind: 'unresolved', why: 'dynamic', written: path };
  // A value glued to the end of the last segment (`/login${query}`) is the query, not the page.
  const trimmed = path.replace(/([^/$}])\$\{[^}]*\}$/, '$1');
  const written = segmentsOf(trimmed.replace(/\$\{[^}]*\}/g, '\u0000'));
  const fits = pages.flatMap((page) => {
    const fit = fitOf(written, page.route);
    return fit === undefined ? [] : [{ page, fit }];
  });
  const best = Math.max(...fits.map((each) => each.fit));
  let top = fits.filter((each) => each.fit === best);
  // One component shown at two addresses that fit as well is still one page.
  if (top.length > 1 && top.every((each) => each.page.fn === top[0]?.page.fn)) top = top.slice(0, 1);
  if (top.length > 1) {
    const nearest = Math.max(...top.map((each) => sharedDirectories(each.page.file, from)));
    top = top.filter((each) => sharedDirectories(each.page.file, from) === nearest);
  }
  const shown = path.replace(/\u0000/g, '${…}');
  if (top.length === 0) return { kind: 'unresolved', why: 'missing', written: shown };
  if (top.length > 1) return { kind: 'unresolved', why: 'ambiguous', written: shown };
  return { kind: 'page', page: (top[0] as { page: Page }).page, by: 'path', written: shown };
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

/** Where `navigateTo(to, options)` lands. */
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

const navigationRow = (ctx: ReactExtractContext, file: string, line: number, symbol: string, landing: Exclude<Landing, { kind: 'page' }>, unplaced = 0): void => {
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
  const land = (from: IndexedFunction, file: string, line: number, landing: Landing, extra: Record<string, unknown>): void => {
    if (landing.kind !== 'page') {
      navigationRow(ctx, file, line, from.name, landing, unplaced);
      return;
    }
    edge(from, landing.page.fn, file, line, {
      [NAVIGATES_META]: landing.written,
      route: landing.page.route,
      page: landing.page.file,
      ...(landing.by === 'name' ? { byName: true } : {}),
      ...extra,
    });
  };
  const linkTags = nuxt ? LINK_TAGS : VUE_ROUTER_LINK_TAGS;

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
          land(owner, file, line, landingOf(pages, navigation.to, navigation.options, file), {
            ...(navigation.replace === true ? { replace: true } : {}),
            ...(redirects ? { redirects: true } : {}),
          });
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
        land(owner, file, startLineOf(node), landingOf(pages, value, undefined, file), { link: tag.getText(), ...(replace ? { replace: true } : {}), ...(link.redirects === true ? { redirects: true } : {}) });
      });
    }
    if (component === undefined || markup === undefined) continue;
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
};

/** What `:to="..."` names: a quoted address, `{ name: '...' }`, or code. */
const boundLanding = (pages: readonly Page[], bound: string, from: string): Landing => {
  const value = bound.trim();
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
