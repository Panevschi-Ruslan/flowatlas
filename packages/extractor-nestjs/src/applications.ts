import type { CallExpression, ClassDeclaration, Node as TsNode, Project } from 'ts-morph';
import { Node } from 'ts-morph';
import { evaluateExpression, normalizeFilePath, type ApplicationMap, type RouteOrder, type Unresolved, startLineOf } from '@flowatlas/core';
import { repoSourcesOf } from './bootstrap.js';
import type { ModuleIndex } from './modules-index.js';
import type { NestClassIndex } from './index-classes.js';
import { resolveClassExpression } from './util/resolve-class.js';

/**
 * Which applications a repository creates, and what each of them mounts.
 *
 * A service is not always one application, and the graph had no room for the
 * difference until R119: two applications writing the same path landed on one
 * entry id, the builder kept the node it already had, and the file that declared
 * the loser produced no node and no row while every total stayed correct.
 *
 * The set of applications was not read at all before this. The bootstrap reader
 * next door folds *one* record per service — assembled from every file that
 * mentions an addressing call and adopted only where they all agree — which is
 * the right shape for a global prefix and says nothing about how many
 * applications there are. Nothing anywhere read `NestFactory`.
 *
 * What is read here is only the roots. Everything else is already in the module
 * pass: it reads every `@Module`, resolves `imports` and `controllers`, and
 * records membership as metadata on the members. So an application is a root
 * module together with the modules it imports, transitively, and a controller
 * belongs to the application whose root reaches the module that declares it.
 */

/** Calls that create an application, by the method name that was written. */
const APPLICATION_FACTORIES = new Set(['create', 'createMicroservice']);

/**
 * The object those calls are written on.
 *
 * Matched by the name rather than by where it was imported from, for the same
 * reason the versioning kind is: this is the framework's own export and it is
 * spelled the same in every repository, while a barrel the checker cannot follow
 * is common enough that insisting on the import would read nothing.
 *
 * `app.connectMicroservice(...)` is deliberately not here, and it is the one
 * call in this family that looks like it belongs and does not. It attaches a
 * second transport to the application that was already created, from the same
 * module tree; it names no root module, and counting it would split one
 * application's addresses in two.
 */
const FACTORY = 'NestFactory';

/** One application, named after the root module the factory call was given. */
export interface ApplicationRoot {
  /** Unique within the repository; what an entry id carries. */
  name: string;
  module: ClassDeclaration;
  /** Repo-relative POSIX path of the call that created it. */
  file: string;
  line: number;
  /**
   * How its router orders routes, where that is not the framework's default
   * (P385): `specificity` on Fastify or with `routeResolutionStrategy:
   * 'specificity'`, `unread` where the adapter or the options could not be
   * read. Absent is the default: the Express adapter, in declaration order.
   */
  routeOrder?: Exclude<RouteOrder, 'declaration'>;
}

/** A call that creates an application whose root module could not be read. */
export interface UnreadApplication {
  file: string;
  line: number;
  text: string;
}

export interface ApplicationsRead {
  roots: ApplicationRoot[];
  unread: UnreadApplication[];
}

const isFactoryCall = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (!APPLICATION_FACTORIES.has(callee.getName())) return false;
  // The last identifier of the expression, so both `NestFactory.create` and a
  // namespace import written as `core.NestFactory.create` answer.
  return /(\w+)\s*$/.exec(callee.getExpression().getText())?.[1] === FACTORY;
};

/**
 * A name per root that is unique in the repository and stable across machines.
 *
 * The root module's own name, which is what the factory call names and what
 * anybody reading the source would call the application. Where two roots are
 * classes of the same name — two `AppModule`s in a workspace of applications,
 * which is the shape this ticket came from — the file distinguishes them,
 * because a name that stood for both would put the two address spaces back
 * together again.
 */
/** `NestFactory.create`, which makes an application serving HTTP. */
const isHttpFactory = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'create';
};

/** How a value names an HTTP adapter: by its class, `new FastifyAdapter()`, or by its type. */
const adapterNamed = (node: TsNode, depth = 0): string | undefined => {
  const unwrapped = Node.isParenthesizedExpression(node) || Node.isAsExpression(node) ? node.getExpression() : node;
  if (Node.isNewExpression(unwrapped)) return /(\w+)\s*$/.exec(unwrapped.getExpression().getText())?.[1];
  if (Node.isIdentifier(unwrapped) && depth < 2) {
    for (const declaration of unwrapped.getSymbol()?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return adapterNamed(initializer, depth + 1);
    }
  }
  const typed = unwrapped.getType().getSymbol()?.getName();
  return typed === undefined || typed === '__type' || typed === '__object' ? undefined : typed;
};

/** What the options handed to the factory say of the order, or `unread`. */
const orderInOptions = (node: TsNode): RouteOrder => {
  if (Node.isObjectLiteralExpression(node)) {
    if (node.getProperties().some((property) => Node.isSpreadAssignment(property))) return 'unread';
    const said = node.getProperty('routeResolutionStrategy');
    if (said === undefined) return 'declaration';
    if (!Node.isPropertyAssignment(said)) return 'unread';
    const initializer = said.getInitializer();
    const value = initializer === undefined ? undefined : evaluateExpression(initializer);
    if (value?.resolved !== true) return 'unread';
    return value.value === 'specificity' ? 'specificity' : value.value === 'declaration' ? 'declaration' : 'unread';
  }
  const value = evaluateExpression(node);
  if (!value.resolved || typeof value.value !== 'object' || value.value === null) return 'unread';
  const said = (value.value as Record<string, unknown>)['routeResolutionStrategy'];
  return said === undefined || said === 'declaration' ? 'declaration' : said === 'specificity' ? 'specificity' : 'unread';
};

/**
 * How the router of the application one factory call creates orders routes
 * (P385).
 *
 * NestJS registers routes in declaration order on its default adapter, which
 * is Express, and the first registered answers; Fastify's router ranks them by
 * specificity whatever the order, and from v12 `routeResolutionStrategy:
 * 'specificity'` in the options sorts them the same way on Express. The
 * adapter is the second argument when one is given, then the options; a type
 * argument naming a Fastify application says the same. A value neither an
 * adapter nor options this can read leaves the order unread.
 */
const routeOrderOfCall = (call: CallExpression): RouteOrder => {
  if (call.getTypeArguments().some((type) => /Fastify/.test(type.getText()))) return 'specificity';
  const [, second, third] = call.getArguments();
  if (second === undefined) return 'declaration';
  if (Node.isObjectLiteralExpression(second)) return orderInOptions(second);
  const adapter = adapterNamed(second);
  if (adapter !== undefined && /FastifyAdapter$/.test(adapter)) return 'specificity';
  if (adapter !== undefined && /ExpressAdapter$/.test(adapter)) return third === undefined ? 'declaration' : orderInOptions(third);
  if (third === undefined) {
    const options = orderInOptions(second);
    if (options !== 'unread') return options;
  }
  return 'unread';
};

const named = (
  found: ReadonlyArray<{ module: ClassDeclaration; file: string; line: number; moduleFile: string; routeOrder: RouteOrder }>,
): ApplicationRoot[] => {
  const counted = new Map<string, number>();
  for (const root of found) {
    const name = root.module.getName() ?? '';
    counted.set(name, (counted.get(name) ?? 0) + 1);
  }
  return found.map((root) => {
    const name = root.module.getName() ?? 'anonymous';
    return {
      name: (counted.get(name) ?? 0) > 1 ? `${name}~${root.moduleFile}` : name,
      module: root.module,
      file: root.file,
      line: root.line,
      ...(root.routeOrder === 'declaration' ? {} : { routeOrder: root.routeOrder }),
    };
  });
};

/**
 * Every application this repository creates.
 *
 * The whole repository is walked rather than the entry file alone, because a
 * second application is routinely created in a file nothing reachable from
 * `main.ts` ever mentions: a worker a supervisor forks by path, a nested
 * application with a `main.ts` of its own. Cheap, because a file is only walked
 * when its text holds the name.
 *
 * One application per root module, not per call: the same module handed to the
 * factory twice is one address space created twice, and two of them would make
 * every address of it ambiguous against itself.
 */
export const readApplicationRoots = (options: {
  project: Project;
  rootDir: string;
}): ApplicationsRead => {
  const { project, rootDir } = options;
  const found: Array<{
    module: ClassDeclaration;
    file: string;
    line: number;
    moduleFile: string;
    routeOrder: RouteOrder;
  }> = [];
  const seen = new Set<ClassDeclaration>();
  const unread: UnreadApplication[] = [];

  for (const sourceFile of repoSourcesOf(project, rootDir, undefined)) {
    if (!sourceFile.getFullText().includes(FACTORY)) continue;
    const file = normalizeFilePath(sourceFile.getFilePath(), rootDir);
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node) || !isFactoryCall(node)) return;
      const line = startLineOf(node);
      const [first] = node.getArguments();
      const ref = first === undefined ? undefined : resolveClassExpression(first);
      if (ref === undefined || ref.kind !== 'local') {
        unread.push({ file, line, text: node.getText().replace(/\s+/g, ' ').slice(0, 90) });
        return;
      }
      if (seen.has(ref.declaration)) return;
      seen.add(ref.declaration);
      found.push({
        module: ref.declaration,
        file,
        line,
        moduleFile: normalizeFilePath(ref.declaration.getSourceFile().getFilePath(), rootDir),
        // A microservice serves no HTTP route, so its order says nothing.
        routeOrder: isHttpFactory(node) ? routeOrderOfCall(node) : 'declaration',
      });
    });
  }

  // By where the call sits, so the order is the repository's and not the
  // filesystem's: two machines that open the files in a different order must
  // name the same applications.
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  unread.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { roots: named(found), unread };
};

/** Declarations one module tree holds: its own members, then its imports'. */
const membersReachedFrom = (root: ClassDeclaration, modules: ModuleIndex): ClassDeclaration[] => {
  const members: ClassDeclaration[] = [];
  const visited = new Set<ClassDeclaration>([root]);
  const queue: ClassDeclaration[] = [root];
  while (queue.length > 0) {
    const declaration = queue.shift() as ClassDeclaration;
    const info = modules.get(declaration);
    if (info === undefined) continue;
    members.push(...info.controllers);
    for (const provider of info.providers) {
      if (provider.declaration !== undefined) members.push(provider.declaration);
    }
    for (const imported of info.imports) {
      const target = imported.declaration;
      if (target === undefined || visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return members;
};

/**
 * Which applications mount each declaration, keyed by symbol id.
 *
 * The symbol id rather than the declaration, because the answer is read by an
 * adapter that has a file and a class name and no parsed tree of this
 * repository's modules — and because it is the identity the rest of the graph
 * already uses for the same class.
 */
export const applicationMembership = (
  roots: readonly ApplicationRoot[],
  modules: ModuleIndex,
  classes: NestClassIndex,
): ApplicationMap => {
  const of = new Map<string, string[]>();
  for (const root of roots) {
    for (const member of membersReachedFrom(root.module, modules)) {
      const id = classes.get(member)?.id;
      if (id === undefined) continue;
      const mounted = of.get(id);
      if (mounted === undefined) of.set(id, [root.name]);
      else if (!mounted.includes(root.name)) mounted.push(root.name);
    }
  }
  const names = roots.map((root) => root.name).sort();
  return {
    names,
    of: Object.fromEntries([...of].map(([id, mounted]) => [id, [...mounted].sort()])),
  };
};

/**
 * The order an application's router registers routes in, as the entry adapter
 * reads it from `meta` (P385): per root, how its router orders routes and its
 * controllers by symbol id in the order they are registered.
 */
export interface RouteRegistration {
  roots: Array<{ name: string; routeOrder?: Exclude<RouteOrder, 'declaration'>; controllers: string[] }>;
}

/**
 * The controllers one module tree registers, in the order NestJS registers
 * their routes (P385).
 *
 * The scanner inserts a module, then walks its `imports` in the order written,
 * depth first, skipping a module it has met; the router then takes the modules
 * in the order they were inserted and each module's `controllers` in the order
 * written, and a controller's handlers in the order its methods are declared.
 * So the root's own controllers come first, then those of its first import and
 * everything that import brings in, then the next.
 *
 * An import of the repository's own that could not be read may bring in
 * modules ahead of the ones after it, so nothing after it is placed: those
 * controllers are left out, and a route of theirs is ordered against no other
 * controller's.
 */
const controllersInOrder = (root: ClassDeclaration, modules: ModuleIndex): ClassDeclaration[] => {
  const out: ClassDeclaration[] = [];
  const visited = new Set<ClassDeclaration>();
  let lost = false;
  const visit = (declaration: ClassDeclaration): void => {
    if (lost || visited.has(declaration)) return;
    visited.add(declaration);
    const info = modules.get(declaration);
    if (info === undefined) return;
    out.push(...info.controllers);
    for (const imported of info.imports) {
      if (imported.declaration !== undefined) visit(imported.declaration);
      else if (imported.kind !== 'external') lost = true;
      if (lost) return;
    }
  };
  visit(root);
  return out;
};

/** How each application registers its routes, for the entry adapter (P385). */
export const routeRegistrationOf = (
  roots: readonly ApplicationRoot[],
  modules: ModuleIndex,
  classes: NestClassIndex,
): RouteRegistration => ({
  roots: roots.map((root) => ({
    name: root.name,
    ...(root.routeOrder === undefined ? {} : { routeOrder: root.routeOrder }),
    controllers: controllersInOrder(root.module, modules).flatMap((member) => {
      const id = classes.get(member)?.id;
      return id === undefined ? [] : [id];
    }),
  })),
});

/**
 * What is said about a factory call whose root module could not be read.
 *
 * One row per call. It costs more than a missing detail: an application nobody
 * could name is an application whose addresses collapse onto another's, which is
 * the silence this ticket is about, so the row says that rather than merely that
 * an argument was computed.
 */
export const applicationFindings = (unread: readonly UnreadApplication[]): Unresolved[] =>
  unread.map((site) => ({
    file: site.file,
    line: site.line,
    reason: 'application-root-unread',
    message: `the root module of an application created here could not be read, so its addresses cannot be told apart from another application's in this service: ${site.text}`,
    hint: 'Pass the root module class itself. An application nobody can name shares an address space with every other one in the service, and the file that loses a shared address contributes no node.',
    symbol: 'NestFactory',
    adapter: 'nestjs-http',
  }));
