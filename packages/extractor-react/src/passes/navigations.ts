import { hasDependency } from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { drawNavigations, navigationConfidence, type DrawEdge, type NavigatingScript, type Page } from '../sfc/navigation.js';
import { routeNames } from '../sfc/routes.js';
import { repoFiles } from '../sfc/stores.js';
import { localePrefixOf } from '../util/locale-routing.js';
import { listedRoutes, routePathsOf, routePlacingOf, routeScreenOf } from './routes.js';
import { definePass } from './types.js';

/**
 * Where a front end that is not Nuxt's navigates (P276): React Router's,
 * Next's, Vue Router's and SvelteKit's navigations, each joined to the page
 * it shows, by the reading Nuxt's go through (`drawNavigations`), which the
 * component reader runs for a Nuxt application itself.
 *
 * The pages are the screens the reading already placed - a component with a
 * `route` on its node, from a route table, `<Route>`, a file under `app/` or
 * `pages/`, or a SvelteKit page - and a Vue Router route's `name` names the
 * component it shows. After the routes and the children, so every screen has
 * its address before a navigation is matched against it.
 */
export const navigationsPass = definePass('navigations', (ctx: ReactExtractContext) => {
  if (hasDependency(ctx.pkg, 'nuxt')) return;
  const sources = repoFiles(ctx);
  const extensions = [...new Set(ctx.embedded.map((made) => made.format.extension))];
  const names = ctx.embedded.length === 0 ? new Map<string, Set<string>>() : routeNames(sources, { repoDir: ctx.repoDir, extensions });

  const pages: Page[] = [];
  for (const indexed of ctx.functions.all()) {
    const meta = ctx.builder.getNode(indexed.id)?.meta;
    const route = meta?.['route'];
    if (typeof route !== 'string' || route === '') continue;
    const named = [...(names.get(indexed.file) ?? [])];
    const branches = typeof meta?.['routeGuessed'] === 'string' ? new Set(meta['routeGuessed'].split(' ')) : new Set<string>();
    for (const path of route.split(' ')) {
      const placing = routePlacingOf(ctx, indexed.id, path);
      const locale = localePrefixOf(ctx.repoDir, indexed.file, path);
      pages.push({
        file: indexed.file,
        route: path,
        fn: indexed,
        ...(named.length === 1 ? { name: named[0] as string } : {}),
        ...(branches.has(path) ? { guessed: true as const } : {}),
        ...(placing.branches.length === 0 ? {} : { branches: placing.branches }),
        ...(placing.within.length === 0 ? {} : { within: placing.within }),
        ...(locale === undefined ? {} : { localePrefix: locale }),
      });
    }
  }
  if (pages.length === 0) return;

  const components = new Map<string, IndexedFunction>();
  for (const indexed of ctx.functions.all()) if (indexed.role === 'component') components.set(indexed.file, indexed);
  const embedded = new Set(ctx.embedded.map((made) => made.sourceFile));
  const scripts: NavigatingScript[] = [
    ...ctx.embedded.flatMap((made) => {
      const component = components.get(made.file);
      return [{ file: made.file, script: made.sourceFile, ...(component === undefined ? {} : { component }), ...(made.format.extension === '.vue' || made.format.extension === '.svelte' ? { markup: made.text } : {}) }];
    }),
    ...sources.filter((source) => !embedded.has(source)).map((script) => ({ file: ctx.fileOf(script), script })),
  ];

  const drawn = new Set<string>();
  const edge: DrawEdge = (from, to, file, line, meta) => {
    if (from.id === to.id) return;
    const key = `${from.id}\u0000${to.id}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    ctx.ensureFunctionNode(from.fn);
    ctx.ensureFunctionNode(to.fn);
    // A page reached through a branch nothing written decides is one of two the build may make (P288).
    ctx.builder.addEdge({ from: from.id, to: to.id, type: 'calls', confidence: navigationConfidence(meta), file, line, meta });
  };
  drawNavigations(ctx, pages, scripts, () => undefined, edge, false, unplacedRoutes(ctx, sources.filter((source) => !embedded.has(source))));
});

const SCREEN_KEYS = ['element', 'Component', 'component'];

/**
 * How many routes of the application are written in a way the route reader
 * does not place - a path built by a call of a package or holding a value
 * read at run time, a screen it cannot name - so a navigation that lands on
 * no placed page may still land on one of them (P276). Read as the route
 * reader reads them (`routePathsOf`, `routeScreenOf`), so a route it places
 * is never counted here (P288).
 */
const unplacedRoutes = (ctx: ReactExtractContext, sources: readonly SourceFile[]): number => {
  let count = 0;
  const placed = (path: TsNode | undefined, screen: TsNode | undefined): boolean => {
    if (routePathsOf(path) === undefined) return false;
    const inner = screen !== undefined && Node.isJsxExpression(screen) ? screen.getExpression() : screen;
    // No screen named: a layout or a redirect, which shows nothing a navigation lands on.
    if (inner === undefined) return true;
    // A lazy `() => import('./X.vue')` is the component reader's to place.
    if (Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) return true;
    // A name, or an element of one, as before; a member or a call the route reader resolves (P288).
    if (Node.isIdentifier(inner)) return true;
    if (Node.isJsxSelfClosingElement(inner) && Node.isIdentifier(inner.getTagNameNode())) return true;
    if (Node.isJsxElement(inner) && Node.isIdentifier(inner.getOpeningElement().getTagNameNode())) return true;
    return routeScreenOf(ctx, inner) !== undefined;
  };
  for (const source of sources) {
    if (!/\bpath\b/.test(source.getFullText())) continue;
    source.forEachDescendant((node) => {
      if (Node.isObjectLiteralExpression(node)) {
        const path = node.getProperty('path');
        const screen = SCREEN_KEYS.map((key) => node.getProperty(key)).find((each) => each !== undefined);
        if (path === undefined || screen === undefined) return;
        const written = Node.isPropertyAssignment(path) ? path.getInitializer() : undefined;
        const shown = Node.isPropertyAssignment(screen) ? screen.getInitializer() : undefined;
        if (!placed(written, shown)) count += 1;
        return;
      }
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) return;
      if (node.getTagNameNode().getText() !== 'Route') return;
      const attribute = (name: string): TsNode | undefined => {
        const found = node.getAttributes().find((each) => Node.isJsxAttribute(each) && each.getNameNode().getText() === name);
        return found !== undefined && Node.isJsxAttribute(found) ? (found.getInitializer() ?? found) : undefined;
      };
      const path = attribute('path');
      if (path === undefined) return;
      const shown = SCREEN_KEYS.map(attribute).find((each) => each !== undefined);
      // A route written over a list's items is one per entry, each counted as the route reader reads it (P291).
      const listed = listedRoutes(path, shown);
      if (listed !== undefined) {
        count += listed.unread + listed.routes.filter((each) => !placed(each.path, each.screen)).length;
        return;
      }
      if (!placed(path, shown)) count += 1;
    });
  }
  return count;
};
