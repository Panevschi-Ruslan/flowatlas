import { APP_PAGES, PAGES_SCREENS, routePathOfFile } from '@flowatlas/adapters-entry';
import { hasDependency, normalizePath } from '@flowatlas/core';
import type { JsxAttributeLike, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { componentIn } from '../util/component.js';
import { listedKey, listEntries } from '../util/list-entries.js';
import { beforeQuery, holdsHole, spelledPaths } from '../util/path-text.js';
import { definePass } from './types.js';

/** The value written for a key of an object, when the object writes one. */
const valueOf = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/** The value written for a named attribute of an element. */
const attributeOf = (
  attributes: readonly JsxAttributeLike[],
  names: readonly string[],
): TsNode | undefined => {
  for (const attribute of attributes) {
    if (!Node.isJsxAttribute(attribute)) continue;
    if (!names.includes(attribute.getNameNode().getText())) continue;
    return attribute.getInitializer();
  }
  return undefined;
};

/**
 * Every address a route's path is written as, each with its optional
 * parameters left out and put in (`/home/:tab?` is `/home` and
 * `/home/:param`), or nothing where it is not read: a path built by a call
 * of a package, or one holding a value read at run time (P288). A path a
 * function of the repository hands back is read through it
 * (`path={startPath()}`, `` `${findPath()}/:query?` ``); one arrived at
 * through a branch nothing decides is `guessed`.
 */
export const routePathsOf = (value: TsNode | undefined): Array<{ readonly path: string; readonly guessed?: true }> | undefined => {
  if (value === undefined) return undefined;
  const inner = Node.isJsxExpression(value) ? value.getExpression() : value;
  if (inner === undefined) return undefined;
  const spelled = spelledPaths(inner);
  // A value in the query is no part of the route; one in the path leaves it unread.
  const paths = spelled?.map((each) => ({ ...each, text: beforeQuery(each.text) }));
  if (paths === undefined || paths.some((each) => holdsHole(each.text))) return undefined;
  const out: Array<{ path: string; guessed?: true }> = [];
  for (const each of paths) {
    for (const path of withOptionals(each.text)) {
      const normal = normalizePath(path);
      if (out.some((other) => other.path === normal)) continue;
      out.push({ path: normal, ...(each.guessed === true ? { guessed: true as const } : {}) });
    }
  }
  return out;
};

/** A path with each optional parameter (`:tab?`) left out and put in, at most a few ways. */
const withOptionals = (path: string): string[] => {
  let out = [''];
  for (const segment of path.split('/').filter((part) => part !== '')) {
    const optional = /^:[^/]+\?$/.test(segment);
    const kept = optional ? segment.slice(0, -1) : segment;
    out = out.flatMap((head) => (optional ? [head, `${head}/${kept}`] : [`${head}/${kept}`]));
    if (out.length > 8) return [path];
  }
  return out.map((each) => (each === '' ? '/' : each));
};

/** The component a route's screen names, written as a name, an element, a lazily loaded module or a member of one. */
export const routeScreenOf = (ctx: ReactExtractContext, value: TsNode | undefined): IndexedFunction | undefined =>
  value === undefined ? undefined : componentIn(ctx, value);

/** One route a list's entry writes: its path and its screen, as the entry writes them. */
export interface ListedRoute {
  readonly path: TsNode | undefined;
  readonly screen: TsNode | undefined;
}

/**
 * The routes a `<Route>` written over a list's items stands for (P291):
 * `configs.map((config) => <Route path={config.path} component={config.component} />)`
 * is one route per entry of the list, its path and its screen the entry's
 * values under the keys the element reads; a screen the element writes
 * outright is every entry's. Nothing where the path is not read off a list's
 * item; `unread` counts the items not written as an object in place.
 */
export const listedRoutes = (pathValue: TsNode | undefined, screenValue: TsNode | undefined): { readonly routes: readonly ListedRoute[]; readonly unread: number } | undefined => {
  if (pathValue === undefined) return undefined;
  const listed = listedKey(pathValue);
  if (listed === undefined) return undefined;
  const read = listEntries(listed.list);
  if (read === undefined) return { routes: [], unread: 1 };
  const screenKey = screenValue === undefined ? undefined : screenKeyOf(screenValue, listed.parameter);
  const routes = read.entries.map((entry) => ({
    path: valueOf(entry, listed.key),
    screen: screenKey === undefined ? screenValue : screenKey === null ? undefined : valueOf(entry, screenKey),
  }));
  return { routes, unread: read.unread };
};

/** The key of a list's item a screen is read from, `null` for another list's item, `undefined` for a screen written outright. */
const screenKeyOf = (screen: TsNode, parameter: TsNode): string | null | undefined => {
  const inner = Node.isJsxExpression(screen) ? screen.getExpression() : screen;
  if (inner === undefined) return undefined;
  // `element={<config.Screen />}`: the tag is the item's member.
  const tag = Node.isJsxSelfClosingElement(inner) ? inner.getTagNameNode() : Node.isJsxElement(inner) ? inner.getOpeningElement().getTagNameNode() : inner;
  const listed = listedKey(tag);
  if (listed !== undefined) return listed.parameter === parameter ? listed.key : null;
  return undefined;
};

/**
 * The branches a route element is written under: for each condition
 * (`cond ? <Switch>a</Switch> : <Switch>b</Switch>`) around it, the condition
 * and the side, so two pages at one address that only one side each places
 * are told apart as the build's two choices (P291).
 */
const branchesOf = (ctx: ReactExtractContext, node: TsNode): string[] => {
  const marks: string[] = [];
  for (let child: TsNode = node, at = node.getParent(); at !== undefined && !Node.isSourceFile(at); child = at, at = at.getParent()) {
    if (!Node.isConditionalExpression(at) || child === at.getCondition()) continue;
    marks.push(`${ctx.fileOf(at)}:${at.getStart()}:${child === at.getWhenTrue() ? 'then' : 'else'}`);
  }
  return marks;
};

/** Where a route is written: the conditions around it, and the component whose body writes it. */
interface Placing {
  readonly branches: readonly string[];
  readonly within?: string;
}

/** The component of this reading whose body a route element is written in, the nearest first. */
const writtenWithin = (ctx: ReactExtractContext, node: TsNode): string | undefined => {
  for (let at = node.getParent(); at !== undefined && !Node.isSourceFile(at); at = at.getParent()) {
    if (Node.isFunctionLikeDeclaration(at) || Node.isVariableDeclaration(at)) {
      const indexed = ctx.functions.get(at as never);
      if (indexed !== undefined && indexed.role === 'component') return indexed.id;
    }
  }
  return undefined;
};

const placingOf = (ctx: ReactExtractContext, node: TsNode, within = writtenWithin(ctx, node)): Placing => ({
  branches: branchesOf(ctx, node),
  ...(within === undefined ? {} : { within }),
});

/** How each page's addresses were placed, by the function's id and the address (P291). */
const ROUTE_PLACINGS = new WeakMap<object, Map<string, Map<string, { branches: readonly string[]; within: Set<string> }>>>();

/**
 * How a page was placed at an address (P291): the conditions it was placed
 * under, as `branchesOf` writes them, none where it was placed outright once;
 * and the components whose bodies write a route placing it, so a page placed
 * by routes nested in another page's component is told apart from that one.
 */
export const routePlacingOf = (ctx: ReactExtractContext, id: string, path: string): { readonly branches: readonly string[]; readonly within: readonly string[] } => {
  const found = ROUTE_PLACINGS.get(ctx.builder)?.get(id)?.get(path);
  return { branches: found?.branches ?? [], within: [...(found?.within ?? [])].sort() };
};

/**
 * The address a page of Next's older router is shown at, or nothing: only a
 * file under the application's own `pages/` (or `src/pages/`), not under
 * `pages/api`, and not one whose name starts with an underscore (P276).
 */
const pagesRouterPath = (file: string): string | null => {
  const at = file.startsWith('pages/') ? 0 : file.startsWith('src/pages/') ? 'src/'.length : -1;
  if (at < 0) return null;
  const inside = file.slice(at + 'pages/'.length);
  if (inside.startsWith('api/') || inside.split('/').some((part) => part.startsWith('_'))) return null;
  return routePathOfFile(file.slice(at), PAGES_SCREENS);
};

/** Whether this is the function its file hands out as the default export. */
const isDefaultExport = (indexed: IndexedFunction): boolean => {
  const [declaration] = indexed.fn.declaration
    .getSourceFile()
    .getExportedDeclarations()
    .get('default') ?? [];
  return declaration === indexed.fn.declaration;
};

/**
 * What a screen is, which is the one question React answers three ways.
 *
 * Angular has a routed component and a configuration that names it. React has
 * whatever the router in use says, and the two that matter are unrelated to
 * each other: a table of objects or `<Route>` elements handed to a router
 * library, and a file in the right place under `app/`. A repository may have
 * neither, and then a component is a component and nothing says which of them
 * a browser can arrive at directly — which is a fact about the repository and
 * is recorded as one rather than guessed around.
 *
 * What is recorded is a `route` on the component, not an edge: the address of a
 * screen is not a boundary anything crosses, it is how a person names the
 * screen. `impact` already ends at the component; this is so that the answer
 * can say which screen that is.
 */
export const routesPass = definePass('routes', (ctx: ReactExtractContext) => {
  const routed = new Map<string, Set<string>>();

  const guessed = new Map<string, Set<string>>();
  const placings = new Map<string, Map<string, { branches: readonly string[]; within: Set<string> }>>();
  ROUTE_PLACINGS.set(ctx.builder, placings);
  const claim = (indexed: IndexedFunction | undefined, path: string, placed = false, branch = false, placing: Placing = { branches: [] }): void => {
    // A file a router places is a screen whatever it returns: a page that only redirects is still the page at that address (P276).
    if (indexed === undefined || (indexed.role !== 'component' && !placed)) return;
    const paths = routed.get(indexed.id);
    // A component shown at two addresses keeps both, sorted, so the answer does
    // not depend on which file happened to be read first.
    if (paths === undefined) routed.set(indexed.id, new Set([path]));
    else paths.add(path);
    if (branch) guessed.set(indexed.id, new Set([...(guessed.get(indexed.id) ?? []), path]));
    // Placed at an address outright once, a page is there whichever way a condition goes.
    const byPath = placings.get(indexed.id) ?? new Map<string, { branches: readonly string[]; within: Set<string> }>();
    placings.set(indexed.id, byPath);
    const before = byPath.get(path);
    const within = new Set([...(before?.within ?? []), ...(placing.within === undefined ? [] : [placing.within])]);
    byPath.set(path, { branches: before === undefined ? placing.branches : before.branches.filter((mark) => placing.branches.includes(mark)), within });
  };
  const claimAll = (indexed: IndexedFunction | undefined, paths: ReturnType<typeof routePathsOf>, placing?: Placing): void => {
    for (const each of paths ?? []) claim(indexed, each.path, false, each.guessed === true, placing);
  };

  for (const sourceFile of ctx.project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes('/node_modules/')) continue;

    sourceFile.forEachDescendant((node) => {
      // The table form: `{ path: '/orders', element: <Orders /> }`, or the same
      // with `Component`, which the same library also accepts.
      if (Node.isObjectLiteralExpression(node)) {
        const paths = routePathsOf(valueOf(node, 'path'));
        if (paths === undefined) return;
        claimAll(routeScreenOf(ctx, valueOf(node, 'element') ?? valueOf(node, 'Component')), paths, placingOf(ctx, node));
        return;
      }
      // The element form: `<Route path="/orders" element={<Orders />} />`.
      const attributes = Node.isJsxSelfClosingElement(node)
        ? node.getAttributes()
        : Node.isJsxOpeningElement(node)
          ? node.getAttributes()
          : undefined;
      if (attributes === undefined) return;
      const tag = Node.isJsxSelfClosingElement(node) ? node.getTagNameNode() : (node as never as { getTagNameNode(): TsNode }).getTagNameNode();
      if (tag.getText() !== 'Route') return;
      const pathValue = attributeOf(attributes, ['path']);
      const screenValue = attributeOf(attributes, ['element', 'Component', 'component']);
      const placing = placingOf(ctx, node);
      // A route written over a list's items: one route per entry (P291).
      const listed = listedRoutes(pathValue, screenValue);
      if (listed !== undefined) {
        for (const route of listed.routes) claimAll(routeScreenOf(ctx, route.screen), routePathsOf(route.path), placing);
        return;
      }
      const paths = routePathsOf(pathValue);
      if (paths === undefined) return;
      claimAll(routeScreenOf(ctx, screenValue), paths, placing);
    });
  }

  // The file-system form, which names no component at all: the default export
  // of a file in the right place *is* the screen, and the address is where the
  // file is. Only the default export, because everything else in that file is
  // a part of the screen rather than the screen.
  // The older router's pages too, where the application is Next's (P276): a
  // page a navigation lands on is a screen whichever router shows it.
  const next = hasDependency(ctx.pkg, 'next');
  const pageFiles = new Set<string>();
  for (const indexed of ctx.functions.all()) {
    if (indexed.role === 'hook') continue;
    const path = routePathOfFile(indexed.file, APP_PAGES) ?? (next ? pagesRouterPath(indexed.file) : null);
    if (path !== null && isDefaultExport(indexed)) {
      claim(indexed, path, true);
      pageFiles.add(indexed.file);
    }
  }
  // A page file that hands out another file's component as its own
  // (`import Page from './[slug]/page'; export default Page`): that component
  // is the page at this address too (P288).
  for (const sourceFile of ctx.project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes('/node_modules/')) continue;
    const file = ctx.fileOf(sourceFile);
    if (pageFiles.has(file)) continue;
    const path = routePathOfFile(file, APP_PAGES) ?? (next ? pagesRouterPath(file) : null);
    if (path === null) continue;
    for (const declaration of sourceFile.getExportedDeclarations().get('default') ?? []) {
      if (declaration.getSourceFile() === sourceFile) continue;
      const indexed = ctx.functions.get(declaration as never);
      if (indexed !== undefined && indexed.role !== 'hook') claim(indexed, path, true);
    }
  }

  for (const [id, paths] of routed) {
    const indexed = ctx.functions.byId(id);
    if (indexed !== undefined) {
      const branches = guessed.get(id);
      ctx.ensureFunctionNode(indexed.fn, { route: [...paths].sort().join(' '), ...(branches === undefined ? {} : { routeGuessed: [...branches].sort().join(' ') }) });
    }
  }
});
