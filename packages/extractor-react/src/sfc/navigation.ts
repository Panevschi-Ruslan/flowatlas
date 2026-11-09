import { NAVIGATES_META, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { vueTemplateTags } from './events.js';

/**
 * Where a Nuxt application navigates (P265): `navigateTo(...)` in a page, a
 * component, a route middleware or a composable, and `<NuxtLink to>` in a
 * template, each joined to the page it shows.
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
 * `orders-id`), or the one its `definePageMeta({ name })` writes. A path
 * written as a template is matched with each `${…}` as a parameter. An
 * address with a host, or `{ external: true }`, leaves the application: a
 * note, not a join. An address written as code, and one no page shows, are
 * rows. `abortNavigation()` is recorded on the function that calls it
 * (`meta.abortsNavigation`): the navigation it is called in shows nothing.
 */

/** A page the router can show: its file, its address, its name. */
interface Page {
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
    if (isCatchAll(segment)) return score;
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

/** The page a path lands on: the best fit, or a row where none fits or two fit as well. */
const byPath = (pages: readonly Page[], path: string): Landing => {
  const written = segmentsOf(path.replace(/\$\{[^}]*\}/g, '\u0000'));
  const fits = pages.flatMap((page) => {
    const fit = fitOf(written, page.route);
    return fit === undefined ? [] : [{ page, fit }];
  });
  const best = Math.max(...fits.map((each) => each.fit));
  const top = fits.filter((each) => each.fit === best);
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
const landingOf = (pages: readonly Page[], to: TsNode | undefined, options: TsNode | undefined): Landing => {
  const external = options !== undefined && propertyValue(options, 'external')?.getText() === 'true';
  if (to === undefined) return { kind: 'unresolved', why: 'dynamic', written: '' };
  const text = addressText(to);
  if (text !== undefined) return EXTERNAL.test(text) || (external && !text.startsWith('/')) ? { kind: 'external', written: text } : byPath(pages, text);
  if (Node.isObjectLiteralExpression(to)) {
    const name = propertyValue(to, 'name');
    const path = propertyValue(to, 'path');
    const named = name === undefined ? undefined : addressText(name);
    if (named !== undefined && !named.includes('${')) {
      const found = pages.filter((page) => page.name === named);
      return found.length === 1 ? { kind: 'page', page: found[0] as Page, by: 'name', written: named } : { kind: 'unresolved', why: found.length === 0 ? 'missing' : 'ambiguous', written: named };
    }
    const pathText = path === undefined ? undefined : addressText(path);
    if (name === undefined && pathText !== undefined) return EXTERNAL.test(pathText) ? { kind: 'external', written: pathText } : byPath(pages, pathText);
  }
  return { kind: 'unresolved', why: 'dynamic', written: to.getText().replace(/\s+/g, ' ').slice(0, 60) };
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

const navigationRow = (ctx: ReactExtractContext, file: string, line: number, symbol: string, landing: Exclude<Landing, { kind: 'page' }>): void => {
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
  ctx.report({
    file,
    line,
    reason: 'navigation-unresolved',
    level: landing.why === 'dynamic' ? 'info' : 'action',
    symbol: `${symbol} navigates to ${landing.written}`,
    message:
      landing.why === 'missing'
        ? `${file} navigates to ${landing.written}, which no page of the application shows, so the navigation joins nothing`
        : landing.why === 'ambiguous'
          ? `${file} navigates to ${landing.written}, which two pages of the application fit as well, so which one it shows is not said`
          : `${file} navigates to an address written as code (${landing.written}), so which page it shows is not read`,
    hint:
      landing.why === 'missing'
        ? 'Correct the address or the name, or add the page under `pages/`.'
        : landing.why === 'ambiguous'
          ? 'Rename one of the two pages, so one address is one page.'
          : 'Write the address as a literal or a template of one, or as `{ name: \'...\' }` with a literal name.',
    meta: { cause: 'navigation-unresolved', why: landing.why, navigates: landing.written },
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

export const drawNavigations = (
  ctx: ReactExtractContext,
  routes: ReadonlyMap<string, string>,
  byFile: ReadonlyMap<string, IndexedFunction>,
  scriptOf: (file: string) => SourceFile | undefined,
  scripts: readonly NavigatingScript[],
  /** The function a route middleware file runs, adopted so a call in it has an owner. */
  middlewareOf: (file: string) => IndexedFunction | undefined,
  edge: DrawEdge,
): void => {
  const pages: Page[] = [...routes].flatMap(([file, route]) => {
    const fn = byFile.get(file);
    if (fn === undefined) return [];
    const name = declaredName(scriptOf(file)) ?? pageNameOf(file);
    return [{ file, route, fn, ...(name === undefined ? {} : { name }) }];
  });
  const land = (from: IndexedFunction, file: string, line: number, landing: Landing, extra: Record<string, unknown>): void => {
    if (landing.kind !== 'page') {
      navigationRow(ctx, file, line, from.name, landing);
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

  for (const { file, script, component, markup } of scripts) {
    const text = script.getFullText();
    if (text.includes('navigateTo') || text.includes('abortNavigation')) {
      const middleware = middlewareOf(file);
      script.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const callee = node.getExpression();
        const navigates = isNuxts(callee, 'navigateTo');
        const aborts = !navigates && isNuxts(callee, 'abortNavigation');
        if (!navigates && !aborts) return;
        const owner = ownerOf(ctx, node) ?? middleware ?? component;
        if (owner === undefined) return;
        const line = startLineOf(node);
        if (aborts) {
          // The navigation this runs in shows nothing (P265).
          ctx.ensureFunctionNode(owner.fn, { abortsNavigation: true });
          return;
        }
        const [to, options] = (node as CallExpression).getArguments();
        const replace = options !== undefined && propertyValue(options, 'replace')?.getText() === 'true';
        // `return navigateTo(...)` in a route middleware: the navigation it runs in goes there instead.
        const parent = node.getParent();
        const redirects = middleware !== undefined && parent !== undefined && (Node.isReturnStatement(parent) || Node.isArrowFunction(parent));
        land(owner, file, line, landingOf(pages, to, options), { ...(replace ? { replace: true } : {}), ...(redirects ? { redirects: true } : {}) });
      });
    }
    if (component === undefined || markup === undefined) continue;
    for (const tag of vueTemplateTags(markup)) {
      if (!LINK_TAGS.has(tag.name)) continue;
      const literal = tag.attributes.get('to');
      const bound = tag.attributes.get(':to') ?? tag.attributes.get('v-bind:to');
      const external = tag.attributes.has('external');
      const landing: Landing | undefined =
        typeof literal === 'string'
          ? EXTERNAL.test(literal) || external
            ? { kind: 'external', written: literal }
            : byPath(pages, literal)
          : typeof bound === 'string'
            ? boundLanding(pages, bound)
            : undefined;
      if (landing !== undefined) land(component, file, tag.line, landing, { link: tag.name });
    }
  }
};

/** What `:to="..."` names: a quoted address, `{ name: '...' }`, or code. */
const boundLanding = (pages: readonly Page[], bound: string): Landing => {
  const value = bound.trim();
  const quoted = /^(['"`])([^'"`$]*)\1$/.exec(value);
  if (quoted !== null) {
    const text = quoted[2] as string;
    return EXTERNAL.test(text) ? { kind: 'external', written: text } : byPath(pages, text);
  }
  const named = /^\{\s*name\s*:\s*(['"])([^'"]+)\1\s*(?:,[\s\S]*)?\}$/.exec(value);
  if (named !== null) {
    const name = named[2] as string;
    const found = pages.filter((page) => page.name === name);
    return found.length === 1 ? { kind: 'page', page: found[0] as Page, by: 'name', written: name } : { kind: 'unresolved', why: found.length === 0 ? 'missing' : 'ambiguous', written: name };
  }
  return { kind: 'unresolved', why: 'dynamic', written: value.replace(/\s+/g, ' ').slice(0, 60) };
};
