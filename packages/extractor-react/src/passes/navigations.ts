import { hasDependency } from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { drawNavigations, type DrawEdge, type NavigatingScript, type Page } from '../sfc/navigation.js';
import { routeNames } from '../sfc/routes.js';
import { repoFiles } from '../sfc/stores.js';
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
    const route = ctx.builder.getNode(indexed.id)?.meta?.['route'];
    if (typeof route !== 'string' || route === '') continue;
    const named = [...(names.get(indexed.file) ?? [])];
    for (const path of route.split(' ')) {
      pages.push({ file: indexed.file, route: path, fn: indexed, ...(named.length === 1 ? { name: named[0] as string } : {}) });
    }
  }
  if (pages.length === 0) return;

  const components = new Map<string, IndexedFunction>();
  for (const indexed of ctx.functions.all()) if (indexed.role === 'component') components.set(indexed.file, indexed);
  const embedded = new Set(ctx.embedded.map((made) => made.sourceFile));
  const scripts: NavigatingScript[] = [
    ...ctx.embedded.flatMap((made) => {
      const component = components.get(made.file);
      return [{ file: made.file, script: made.sourceFile, ...(component === undefined ? {} : { component }), ...(made.format.extension === '.vue' ? { markup: made.text } : {}) }];
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
    ctx.builder.addEdge({ from: from.id, to: to.id, type: 'calls', confidence: 'static', file, line, meta });
  };
  drawNavigations(ctx, pages, scripts, () => undefined, edge, false, unplacedRoutes(sources.filter((source) => !embedded.has(source))));
});

const SCREEN_KEYS = ['element', 'Component', 'component'];

/** Whether a screen is written as something the route reader can place: a name, or an element of one. */
const placeable = (value: TsNode | undefined): boolean => {
  const inner = value !== undefined && Node.isJsxExpression(value) ? value.getExpression() : value;
  if (inner === undefined) return true;
  if (Node.isIdentifier(inner)) return true;
  if (Node.isJsxSelfClosingElement(inner)) return Node.isIdentifier(inner.getTagNameNode());
  if (Node.isJsxElement(inner)) return Node.isIdentifier(inner.getOpeningElement().getTagNameNode());
  // A lazy `() => import('./X.vue')` is the component reader's to place.
  return Node.isArrowFunction(inner) || Node.isFunctionExpression(inner);
};

const isLiteral = (value: TsNode | undefined): boolean => {
  const inner = value !== undefined && Node.isJsxExpression(value) ? value.getExpression() : value;
  return inner !== undefined && (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner));
};

/**
 * How many routes of the application are written in a way the route reader
 * does not place - a path built by a call or a template, a screen named by a
 * member (`Scenes.Home.Component`) - so a navigation that lands on no placed
 * page may still land on one of them (P276).
 */
const unplacedRoutes = (sources: readonly SourceFile[]): number => {
  let count = 0;
  for (const source of sources) {
    if (!/\bpath\b/.test(source.getFullText())) continue;
    source.forEachDescendant((node) => {
      if (Node.isObjectLiteralExpression(node)) {
        const path = node.getProperty('path');
        const screen = SCREEN_KEYS.map((key) => node.getProperty(key)).find((each) => each !== undefined);
        if (path === undefined || screen === undefined) return;
        const written = Node.isPropertyAssignment(path) ? path.getInitializer() : undefined;
        const shown = Node.isPropertyAssignment(screen) ? screen.getInitializer() : undefined;
        if (!isLiteral(written) || !placeable(shown)) count += 1;
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
      if (!isLiteral(path) || !placeable(shown)) count += 1;
    });
  }
  return count;
};
