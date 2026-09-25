import type { EntryAdapter, EntryHandler, EntryNode, ExtractContext } from '@flowatlas/core';
import {
  evaluateExpression,
  hasAnyDependency,
  isHttpMethod,
  makeEntryId,
  makeHttpEntryKey,
  normalizePath,
  originOfValue,
  packageOfPath,
  resolveTypeOrigin,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { MountShape, RouteDialect } from './route-dialects.js';
import { EXPRESS, FASTIFY, HONO, KOA } from './route-dialects.js';
import {
  enclosingClass,
  fileOfNode,
  handlerOfFunction,
  handlerReturned,
  inlineHandlerOf,
  joinPath,
  repoFunctionOf,
  repoSources,
} from './shared.js';

const DYNAMIC_PATH_HINT =
  'Give the route a string literal or a const string; a computed path cannot be matched against callers.';

/** How much of an expression is quoted when it is named rather than followed. */
const LABEL_LENGTH = 40;

const label = (node: TsNode | undefined): string =>
  node === undefined ? '' : (node.getText().split('\n')[0]?.slice(0, LABEL_LENGTH) ?? '');

const unwrap = (expr: TsNode): TsNode =>
  Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr)
    ? unwrap(expr.getExpression())
    : expr;

/** The string an expression spells out, or undefined when it spells out none. */
const stringArg = (argument: TsNode | undefined): string | undefined => {
  if (argument === undefined) return undefined;
  const value = evaluateExpression(argument);
  return value.resolved && typeof value.value === 'string' ? value.value : undefined;
};

/** The verbs a call was given, as written: one, or a list of them. */
const verbsArg = (argument: TsNode | undefined): string[] | undefined => {
  if (argument === undefined) return undefined;
  const value = evaluateExpression(argument);
  if (!value.resolved) return undefined;
  const raw = Array.isArray(value.value) ? value.value : [value.value];
  const verbs: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !isHttpMethod(item)) return undefined;
    verbs.push(item.toUpperCase());
  }
  return verbs.length > 0 ? verbs : undefined;
};

/** The value of one key of an object written at the call site. */
const propertyOf = (argument: TsNode | undefined, key: string): TsNode | undefined => {
  if (argument === undefined) return undefined;
  const literal = unwrap(argument);
  if (!Node.isObjectLiteralExpression(literal)) return undefined;
  const property = literal.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/**
 * Whether a type is one the framework declares routes on.
 *
 * The base classes are walked as well as the type itself, because wrapping a
 * router in a class of one's own is ordinary — `koa-swagger-decorator` ships
 * `class SwaggerRouter extends Router`, and a repository using it declares its
 * routes on a type from a package this has never heard of. What makes those
 * calls routes is still the router underneath.
 */
const isApp = (expr: TsNode, dialect: RouteDialect): boolean => {
  const origin = resolveTypeOrigin(expr);
  if (origin === null) return false;
  const named = (pkg: string | null, typeName: string | undefined): boolean =>
    pkg !== null &&
    typeName !== undefined &&
    dialect.appTypes.some((app) => app.package === pkg && app.typeName === typeName);
  if (named(origin.package, origin.typeName)) return true;

  let current = Node.isClassDeclaration(origin.declaration)
    ? origin.declaration.getBaseClass()
    : undefined;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    if (named(packageOfPath(current.getSourceFile().getFilePath()), current.getName())) return true;
    current = current.getBaseClass();
  }
  return false;
};

/** A call of the shape `<app>.<method>(…)`, which is all this reads. */
interface AppCall {
  call: TsNode;
  receiver: TsNode;
  method: string;
  args: TsNode[];
  /** Where in the repository it is written, for putting installs in order. */
  site: Site;
  /**
   * How the call is written, when that is not `<receiver>.<method>`.
   *
   * A chained declaration is rewritten into the positional form before anything
   * reads it, and the rewritten shape is not what anybody would find in the
   * file. The entry says how a route was registered, so it has to say the form
   * that is really there.
   */
  as?: string;
}

/** Where something was written, kept so a folded row still points somewhere. */
interface Site {
  file: string;
  line: number;
  /** Position within the file, which is the order the framework sees things in. */
  pos: number;
}

const siteOf = (node: TsNode, ctx: ExtractContext): Site => ({
  file: fileOfNode(node, ctx),
  line: node.getStartLineNumber(),
  pos: node.getStart(),
});

/**
 * The application and the path behind a verb written on a chained route object.
 *
 * `app.route('/books').get(list).post(create)` declares both routes at
 * `/books`, and neither verb is written on the application: the receiver of
 * `get` is an `IRoute`, a type no row here mentions and nothing downstream
 * would recognise. Rather than teach the rest of the reader about a second kind
 * of receiver, the chain is walked back to the call that carries the path — it
 * is a chain of verbs, since the route object answers with itself — and the
 * declaration is handed on as the positional form the framework's other
 * spelling would have produced.
 */
const chainedRoute = (
  receiver: TsNode,
  dialect: RouteDialect,
): { app: TsNode; path: TsNode; written: string } | undefined => {
  if (dialect.pathMethod === undefined) return undefined;
  let at = unwrap(receiver);
  for (let depth = 0; depth < 16; depth += 1) {
    if (!Node.isCallExpression(at)) return undefined;
    const callee = at.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.getName();
    const inner = callee.getExpression();
    if (method === dialect.pathMethod) {
      const path = at.getArguments()[0];
      if (path === undefined || !isApp(inner, dialect)) return undefined;
      return { app: inner, path, written: `${label(inner)}.${method}(${label(path)})` };
    }
    // Anything but a verb means this is not a route object: `app.use(…)` hands
    // back the application itself, which the ordinary path already reads.
    if (dialect.verbs[method] === undefined) return undefined;
    at = unwrap(inner);
  }
  return undefined;
};

const appCallsIn = function* (
  sourceFile: SourceFile,
  dialect: RouteDialect,
  ctx: ExtractContext,
): Generator<AppCall> {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const receiver = callee.getExpression();
    const method = callee.getName();
    const site = siteOf(call, ctx);
    const chained = dialect.verbs[method] === undefined ? undefined : chainedRoute(receiver, dialect);
    if (chained !== undefined) {
      yield {
        call,
        receiver: chained.app,
        method,
        args: [chained.path, ...call.getArguments()],
        site,
        as: `${chained.written}.${method}`,
      };
      continue;
    }
    if (!isApp(receiver, dialect)) continue;
    yield { call, receiver, method, args: call.getArguments(), site };
  }
};

/**
 * The declaration an application value stands for.
 *
 * `originOfValue` stops at a default export, and a router is almost always
 * `const router = express.Router()` followed by `export default router` and
 * imported under a name of the importer's choosing. Stopping there would key
 * the mount on the export statement and the routes on the variable, and the
 * two would never meet — thirty-three mounted routers read as thirty-three
 * applications nothing mounts.
 */
const appDeclaration = (expr: TsNode | undefined): TsNode | undefined => {
  if (expr === undefined) return undefined;
  const origin = originOfValue(unwrap(expr));
  if (origin.kind !== 'local') return undefined;
  const declaration = origin.declaration;
  if (Node.isExportAssignment(declaration)) return appDeclaration(declaration.getExpression());
  // `export { protectedRouter }` written apart from the declaration: the symbol
  // an importer sees is the specifier, and the routes are declared on what it
  // names. Both spellings of an export have to arrive at the same node or a
  // router and the mount that places it never meet.
  if (Node.isExportSpecifier(declaration)) {
    return declaration.getLocalTargetDeclarations()[0];
  }
  return declaration;
};

/**
 * The application a function of this repository hands back.
 *
 * `router.use('/login/' + name, createSAMLAuthRouter(name))` mounts a router
 * built and returned by a factory, which is how a repository writes one router
 * per configured provider. Without following the one step into the factory the
 * mount is invisible, and the routes it declares are not merely missing — they
 * are recorded at the path they are written at, which is not a path the service
 * serves. A wrong address is worse than none, so this step is worth taking.
 *
 * Only when the function hands back one application; several is a factory
 * choosing between them, and either could be the one mounted here.
 */
const returnedApp = (fn: TsNode): TsNode | undefined => {
  const found = new Set<TsNode>();
  for (const statement of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const inside = statement.getFirstAncestor(
      (at) =>
        Node.isArrowFunction(at) || Node.isFunctionExpression(at) || Node.isFunctionDeclaration(at),
    );
    if (inside !== fn) continue;
    const expression = statement.getExpression();
    const declaration = expression === undefined ? undefined : appDeclaration(expression);
    if (declaration !== undefined) found.add(declaration);
  }
  if (found.size === 1) return [...found][0];
  // An arrow written as one expression has no `return` to find.
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    return Node.isBlock(body) ? undefined : appDeclaration(body);
  }
  return undefined;
};

/** The function an expression stands for, whether written here or named. */
const functionOf = (expr: TsNode | undefined): TsNode | undefined => {
  const node = unwrap(expr ?? (undefined as unknown as TsNode));
  if (node === undefined) return undefined;
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return node;
  const declaration = appDeclaration(node);
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer === undefined ? undefined : functionOf(initializer);
  }
  return undefined;
};

/** The first parameter of the function an expression stands for, if it has one. */
const firstParameterOf = (expr: TsNode | undefined): TsNode | undefined => {
  if (expr === undefined) return undefined;
  const fn = functionOf(expr);
  if (fn === undefined) return undefined;
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn)) {
    return fn.getParameters()[0];
  }
  return undefined;
};

/**
 * The application an argument of a mount names.
 *
 * Three ways it can be written, and which ones a framework uses is on its row:
 * the value itself, the first parameter of a plugin function the framework will
 * call with an instance of its own, or the middleware a router turns itself
 * into.
 */
const mountedApp = (
  argument: TsNode | undefined,
  mount: MountShape,
  dialect: RouteDialect,
): TsNode | undefined => {
  if (argument === undefined) return undefined;
  if (mount.asPlugin === true) {
    const parameter = firstParameterOf(argument);
    return parameter !== undefined && isApp(parameter, dialect) ? parameter : undefined;
  }
  const node = unwrap(argument);
  if (mount.through !== undefined && Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && mount.through.includes(callee.getName())) {
      const router = callee.getExpression();
      return isApp(router, dialect) ? appDeclaration(router) : undefined;
    }
  }
  // The one thing that tells a mount from a middleware install written with the
  // same method is whether what is handed over is an application.
  if (!isApp(node, dialect)) return undefined;
  if (Node.isCallExpression(node)) {
    const fn = functionOf(node.getExpression());
    return fn === undefined ? undefined : returnedApp(fn);
  }
  return appDeclaration(node);
};

/**
 * The declaration an expression is the value of, when it is written as one.
 *
 * Only through a chain of calls, because that is the shape it exists for:
 * `const router = express.Router().use(auth)` is still the declaration of
 * `router`, and a route written on the same chain is written on it.
 */
const namedBy = (node: TsNode): TsNode | undefined => {
  let at: TsNode | undefined = node;
  for (let depth = 0; at !== undefined && depth < 16; depth += 1) {
    const parent: TsNode | undefined = at.getParent();
    if (parent === undefined) return undefined;
    if (Node.isVariableDeclaration(parent) || Node.isPropertyDeclaration(parent)) {
      return parent.getInitializer() === at ? parent : undefined;
    }
    if (Node.isPropertyAccessExpression(parent) || Node.isCallExpression(parent)) {
      at = parent;
      continue;
    }
    if (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent)) {
      at = parent;
      continue;
    }
    return undefined;
  }
  return undefined;
};

/**
 * Every application assigned to a binding that was declared without one.
 *
 * `let authRouter: Router | undefined;` and then a `switch` assigning one of
 * five factories to it, before `router.use('/login/' + name, authRouter)`. The
 * mount names the binding, and the routes are declared on whichever router the
 * branch built, so a mount recorded against the binding alone reaches none of
 * them — and the five routers keep the addresses they are written at, which is
 * not where any of them is served.
 *
 * Recorded against all five. A binding that may hold any of them is mounted
 * here whichever it holds, and a route that may be served at this path is
 * better described by this path than by the root of the service.
 */
const assignedApps = (declaration: TsNode, dialect: RouteDialect): TsNode[] => {
  const out = new Set<TsNode>();
  for (const assignment of declaration
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = assignment.getLeft();
    if (!Node.isIdentifier(left) || appDeclaration(left) !== declaration) continue;
    const right = unwrap(assignment.getRight());
    if (!isApp(right, dialect)) continue;
    const fn = Node.isCallExpression(right) ? functionOf(right.getExpression()) : undefined;
    const found = fn === undefined ? appDeclaration(right) : returnedApp(fn);
    if (found !== undefined) out.add(found);
  }
  return [...out];
};

/**
 * Methods that hand back the application they were called on.
 *
 * A mount, a middleware install and a route declaration all do, which is what
 * makes `app.use(a).use(b)` and `Router().get(…).post(…)` work. A prefix method
 * is deliberately not one: Hono's returns a different application.
 */
const passesThrough = (method: string, dialect: RouteDialect): boolean =>
  method === dialect.mount?.method ||
  method === dialect.middleware?.install ||
  method === dialect.verbArgument ||
  dialect.verbs[method] !== undefined;

/**
 * The declaration an application expression belongs to, through a chain.
 *
 * `app.use(router.routes())` is still `app`, and the middleware installed on
 * `app` is in front of whatever that call mounts. Without this the second half
 * of a chained mount looks like an application nobody declared, and the guards
 * the parent installs are lost for every route under it.
 */
const appOwner = (expr: TsNode, dialect: RouteDialect): TsNode | undefined => {
  let at = unwrap(expr);
  for (let depth = 0; depth < 16; depth += 1) {
    if (!Node.isCallExpression(at)) break;
    const callee = at.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    if (!passesThrough(callee.getName(), dialect)) break;
    at = unwrap(callee.getExpression());
  }
  return appDeclaration(at);
};

/** The argument at a position, counting from the end when it is negative. */
const argumentAt = (args: readonly TsNode[], at: number): TsNode | undefined =>
  at < 0 ? args[args.length + at] : args[at];

/** Middleware installed on a whole application, rather than on one route. */
interface Install {
  /** Where it was installed, so routes declared before it are not behind it. */
  site: Site;
  /** The path it is scoped to, absolute once the application's own base is known. */
  at?: string;
  /** The middleware, as it is spelled. */
  names: string[];
}

/** Where one application is reached, and what stands in front of it there. */
interface RouteContext {
  prefix: string;
  guards: readonly Install[];
}

const ROOT: RouteContext = { prefix: '', guards: [] };

/** Whether middleware scoped to a path covers a route served at another. */
const covers = (at: string | undefined, path: string): boolean => {
  if (at === undefined) return true;
  const base = at.replace(/\/?\*+$/, '');
  return base === '' || base === '/' || path === base || path.startsWith(`${base}/`);
};

/**
 * Where one application is hung inside another.
 *
 * `parent.use('/admin', admin)` says every route declared on `admin` is served
 * a level down, and `admin` is usually declared in another file entirely. The
 * mount is recorded against the declaration so that a route found later, on the
 * other side of an import, can be placed where it is really served.
 */
interface Mount {
  parent: TsNode;
  /** Where the mount is written: middleware installed after it is not in front of it. */
  site: Site;
  /** Absent when the mount path could not be read. */
  at?: string;
}

/**
 * Every place an application's base is shifted or its middleware installed,
 * collected before any route is.
 *
 * A mount may be written after the routes it moves, or in a different file, so
 * there is no order in which one pass would do. `shifts` says whether the
 * repository moves any application at all: where nothing does, every application
 * in it serves what it declares, which is what makes an application arriving as
 * a parameter readable rather than a guess.
 */
class Applications {
  readonly #dialect: RouteDialect;
  /** Held so that a walk started anywhere can say where a call is written. */
  readonly #ctx: ExtractContext;
  readonly #mounts = new Map<TsNode, Mount[]>();
  readonly #installs = new Map<TsNode, Install[]>();
  /** Prefixes a mutating prefix call put in front of a whole router. */
  readonly #shifted = new Map<TsNode, string | undefined>();
  #shifts = false;

  constructor(dialect: RouteDialect, ctx: ExtractContext) {
    this.#dialect = dialect;
    this.#ctx = ctx;
  }

  get shifts(): boolean {
    return this.#shifts;
  }

  collect(site: AppCall): void {
    const dialect = this.#dialect;
    if (dialect.prefixMethod !== undefined && site.method === dialect.prefixMethod) {
      this.#shifts = true;
      // A prefix that changes the router it is called on moves every route on
      // it, wherever the call is written; one that returns a new application
      // moves only what is written on what it returned, which the chain in
      // `contextsOf` reads instead.
      if (dialect.prefixMutates === true) {
        const declaration = appDeclaration(site.receiver);
        if (declaration !== undefined) this.#shifted.set(declaration, stringArg(site.args[0]));
      }
      return;
    }
    if (this.#collectMount(site)) return;
    this.#collectInstall(site);
  }

  /** True when the call hung an application somewhere, mount path or not. */
  #collectMount(site: AppCall): boolean {
    const mount = this.#dialect.mount;
    if (mount === undefined || site.method !== mount.method) return false;
    const written = argumentAt(site.args, mount.appAt);
    const declaration = mountedApp(written, mount, this.#dialect);
    // `use` both mounts and installs, and the only thing that tells them apart
    // is whether what is handed over is an application.
    if (declaration === undefined) {
      // A mount this cannot follow still moves an application. `@fastify/autoload`
      // registers a whole directory and takes the prefix from the directory's
      // name, which is a file-system router and a different ticket — but a
      // repository that does it is one where an application arriving as a
      // parameter is served somewhere nothing here can name, and saying its
      // routes are at the paths they are written at would be a wrong address
      // rather than a missing one.
      const shared = this.#dialect.middleware?.install === mount.method;
      if (!shared || (written !== undefined && isApp(unwrap(written), this.#dialect))) {
        this.#shifts = true;
      }
      return false;
    }
    this.#shifts = true;
    const at = this.#mountPath(site, mount);
    const empty =
      Node.isVariableDeclaration(declaration) && declaration.getInitializer() === undefined;
    for (const target of [declaration, ...(empty ? assignedApps(declaration, this.#dialect) : [])]) {
      const found = this.#mounts.get(target) ?? [];
      found.push({ parent: site.receiver, site: site.site, ...(at === undefined ? {} : { at }) });
      this.#mounts.set(target, found);
    }
    return true;
  }

  #mountPath(site: AppCall, mount: MountShape): string | undefined {
    if (mount.prefixKey !== undefined) {
      const written = propertyOf(site.args[mount.prefixKey.at], mount.prefixKey.key);
      // A plugin registered with no prefix at all is mounted where its parent
      // is, which is a readable answer and not a missing one.
      return written === undefined ? '' : stringArg(written);
    }
    if (mount.pathAt === undefined) return '';
    const written = argumentAt(site.args, mount.pathAt);
    // Express mounts a router with no path of its own at its parent's base.
    return written === undefined || !isPathLike(written) ? '' : stringArg(written);
  }

  #collectInstall(site: AppCall): void {
    const shape = this.#dialect.middleware;
    if (shape === undefined || site.method !== shape.install) return;
    const first = site.args[0];
    const named = shape.named === true;
    const scoped = !named && shape.scoped === true && first !== undefined && isPathLike(first);
    const rest = site.args.slice(named || scoped ? 1 : 0);
    if (rest.length === 0) return;
    const declaration = appDeclaration(site.receiver);
    if (declaration === undefined) return;
    const at = scoped ? stringArg(first) : undefined;
    const found = this.#installs.get(declaration) ?? [];
    found.push({
      site: site.site,
      ...(at === undefined ? {} : { at }),
      names: rest.map(label),
    });
    this.#installs.set(declaration, found);
  }

  /**
   * The middleware an application carries in front of what is written after a
   * given point in it.
   *
   * Order is the whole of it: middleware applies to the routes declared after
   * it and to nothing declared before. Within a file that order is where the
   * calls are written. Across files it is the order the modules are evaluated
   * in, which nothing here reads, so an install in another file is left out
   * rather than guessed at — see the note on `middlewareOf`.
   */
  guardsOn(declaration: TsNode | undefined, before: Site, prefix: string): Install[] {
    if (declaration === undefined) return [];
    return (this.#installs.get(declaration) ?? [])
      .filter((install) => install.site.file === before.file && install.site.pos < before.pos)
      .map((install) =>
        install.at === undefined ? install : { ...install, at: joinPath(prefix, install.at) },
      );
  }

  /**
   * Every way an application is reached, or undefined when it cannot be told.
   *
   * Usually one, and usually the root: an application that is nobody's
   * sub-application and shifts nothing serves what it declares, with nothing in
   * front of it but what it installs on itself. More than one is an application
   * mounted twice, which really does serve every route of it at both places —
   * and may be behind different middleware at each.
   */
  contextsOf(expr: TsNode, seen: Set<TsNode> = new Set()): RouteContext[] | undefined {
    const node = unwrap(expr);
    const dialect = this.#dialect;

    if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
      const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
      if (callee !== undefined && Node.isPropertyAccessExpression(callee)) {
        const method = callee.getName();
        const inner = isApp(callee.getExpression(), dialect)
          ? this.contextsOf(callee.getExpression(), seen)
          : undefined;
        if (inner !== undefined) {
          // A mount, an install and a route declaration all return the
          // application they were called on, so a route written after one of
          // them in a chain is on that same application — `Router().post(…)
          // .post(…)` declares both on the router, not the second on the first.
          if (passesThrough(method, dialect)) return inner;
          if (method === dialect.prefixMethod) {
            const at = stringArg(node.getArguments()[0]);
            if (at === undefined) return undefined;
            // An application handed back with a prefix in front of it is a new
            // application only as far as the address goes: it answers through
            // the one it came from, so everything installed there before this
            // line is in front of every route written on it. Without this,
            // `const internal = app.basePath('/internal')` loses the
            // `app.use('*', …)` above it for every route under `internal` —
            // which used to be invisible, because the one framework with a
            // prefix method of this kind had no installs read at all.
            const owner = appOwner(callee.getExpression(), dialect);
            const here = siteOf(node, this.#ctx);
            return inner.map((context) => ({
              prefix: joinPath(context.prefix, at),
              guards: [...context.guards, ...this.guardsOn(owner, here, context.prefix)],
            }));
          }
          return undefined;
        }
      }
      // `new Hono()`, `express()`, `express.Router()`, `new Router({ prefix })`:
      // an application made here, serving what is declared on it.
      if (isApp(node, dialect)) {
        // Where the expression is what a name was given to, the name is what
        // gets mounted, and a route written on the expression itself is served
        // wherever that name is — `export const aiRouter = Router().post(…)`
        // declares a route on a router mounted at `/ai` in another file.
        const owner = namedBy(node);
        if (owner !== undefined && !seen.has(owner)) return this.#ofDeclaration(owner, seen);
        const option =
          dialect.prefixOption === undefined
            ? undefined
            : stringArg(propertyOf(node.getArguments()[0], dialect.prefixOption));
        return [{ ...ROOT, prefix: option === undefined ? '' : option }];
      }
      return undefined;
    }

    const declaration = appDeclaration(node);
    return declaration === undefined ? undefined : this.#ofDeclaration(declaration, seen);
  }

  /**
   * `seen` is the walk down to here, not everything ever visited.
   *
   * An application mounted twice on the same parent — which is exactly what
   * `app.use(router.routes()).use(router.allowedMethods())` is — asks for that
   * parent's base twice, and a set that remembers the first answer refuses the
   * second as a cycle. Every route on every Koa router in the repository then
   * comes back as "mounted somewhere this cannot read". So the declaration is
   * taken off the path on the way out.
   */
  #ofDeclaration(declaration: TsNode, seen: Set<TsNode>): RouteContext[] | undefined {
    // An application that reaches itself has no base that terminates, and a
    // depth limit here would only choose an arbitrary answer to that.
    if (seen.has(declaration)) return undefined;
    seen.add(declaration);
    try {
      return this.#basesOf(declaration, seen);
    } finally {
      seen.delete(declaration);
    }
  }

  #basesOf(declaration: TsNode, seen: Set<TsNode>): RouteContext[] | undefined {
    const shifted = this.#shifted.get(declaration);
    if (this.#shifted.has(declaration) && shifted === undefined) return undefined;

    const initializer = Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : Node.isPropertyDeclaration(declaration)
        ? declaration.getInitializer()
        : undefined;
    // A parameter, or a binding whose value is not written here: the base is
    // whatever the caller had, which only the caller knows.
    const written = initializer === undefined ? undefined : this.contextsOf(initializer, seen);
    const own =
      written === undefined || shifted === undefined
        ? written
        : written.map((context) => ({ ...context, prefix: joinPath(shifted, context.prefix) }));

    const mounts = this.#mounts.get(declaration);
    if (mounts === undefined) return own;

    const out: RouteContext[] = [];
    for (const mount of mounts) {
      if (mount.at === undefined) return undefined;
      const above = this.contextsOf(mount.parent, seen);
      if (above === undefined) return undefined;
      const parent = appOwner(mount.parent, this.#dialect);
      for (const outer of above) {
        // Everything the parent installed before the mount is in front of every
        // route underneath it. This is the whole of middleware-through-mounting:
        // `app.use(authenticate)` above `app.use('/users', usersRouter)` guards
        // every route `usersRouter` declares, in a file it never appears in.
        const inherited = [
          ...outer.guards,
          ...this.guardsOn(parent, mount.site, outer.prefix),
        ];
        for (const inner of own ?? [ROOT]) {
          out.push({
            prefix: joinPath(outer.prefix, mount.at, inner.prefix),
            guards: [...inherited, ...inner.guards],
          });
        }
      }
    }
    return out;
  }
}

/**
 * Whether an argument reads as a path rather than as something to run.
 *
 * By its type and not by how it is written, because `'/orders'`, `prefix +
 * '/orders'`, `pathFor('orders')` and a `const` from another file are all the
 * path argument and only the first looks like one. Reading `prefix + '/orders'`
 * as "no path given" mounted a router at the root of the service, which is an
 * address it does not serve.
 */
const isPathLike = (argument: TsNode): boolean => {
  const node = unwrap(argument);
  if (Node.isArrayLiteralExpression(node)) return true;
  // Written as one, whatever the checker makes of it. A template with a value
  // in it has a template literal type rather than `string`, and reading that as
  // "no path was given" mounts a router at its parent's base — the address of
  // every route under it, wrong by one segment and with nothing to say so.
  if (
    Node.isStringLiteral(node) ||
    Node.isTemplateExpression(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return true;
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return false;
  const type = node.getType();
  const stringy = (candidate: {
    isString(): boolean;
    isStringLiteral(): boolean;
    isTemplateLiteral?(): boolean;
  }): boolean =>
    candidate.isString() || candidate.isStringLiteral() || candidate.isTemplateLiteral?.() === true;
  return type.isUnion() ? type.getUnionTypes().every(stringy) : stringy(type);
};

/** What answers one route, and how confidently that could be said. */
interface Answer {
  handler?: EntryHandler;
  /** `function` named outright, `call` returned by one written in place, else none. */
  via: 'function' | 'call' | 'inline';
}

/**
 * The function a handler argument really is, through the wrapper around it.
 *
 * `asyncHandler(async (req, res) => …)` is how most of Express catches a
 * rejected promise, and the wrapper is not the handler: it is a call that
 * returns one. A call with exactly one argument, and that argument a function
 * written in place, stands for that function — narrow on purpose, so that
 * `rateLimit({ max: 5 })` and `useCollection('users')`, which take a value and
 * return middleware, are not mistaken for it.
 */
const throughWrapper = (argument: TsNode | undefined): TsNode | undefined => {
  if (argument === undefined) return undefined;
  const node = unwrap(argument);
  if (!Node.isCallExpression(node)) return node;
  const args = node.getArguments();
  const only = args.length === 1 ? unwrap(args[0] as TsNode) : undefined;
  return only !== undefined && (Node.isArrowFunction(only) || Node.isFunctionExpression(only))
    ? throughWrapper(only)
    : node;
};

/**
 * The code behind a route.
 *
 * The last argument is the handler and anything before it is middleware, which
 * is how the framework itself reads the call. A named function is the answer
 * outright; one written in place is read for the single thing it hands the
 * answer over to, and only for that — see `handlerReturned`.
 *
 * Deliberately no fall back to whatever declaration the registration is written
 * inside, which is what the bot adapter does. A bot registration written in a
 * method at least names code that runs when the button is pressed; a route
 * written inside `registerAdminRoutes(app)` does not — the registrar runs once
 * at start-up and never again, and pointing the route at it would claim every
 * request runs every route in the file.
 */
const answerOf = (call: TsNode, argument: TsNode | undefined, ctx: ExtractContext): Answer => {
  const named = repoFunctionOf(argument);
  if (named !== undefined) return { handler: handlerOfFunction(named, ctx), via: 'function' };
  const inside = handlerReturned(argument, enclosingClass(call), ctx);
  return inside === undefined ? { via: 'inline' } : { handler: inside, via: 'call' };
};

/** One route, as declared. */
interface Route {
  verbs: string[];
  path: string;
  /** Middleware written for this route alone, as it is spelled. */
  middleware: string[];
  answer: Answer;
}

/** Middleware named by the keys of an options object written at the call site. */
const optionMiddleware = (argument: TsNode, dialect: RouteDialect): string[] => {
  const keys = dialect.middleware?.optionKeys ?? [];
  const out: string[] = [];
  for (const key of keys) {
    const written = propertyOf(argument, key);
    if (written === undefined) continue;
    const node = unwrap(written);
    const items = Node.isArrayLiteralExpression(node) ? node.getElements() : [node];
    for (const item of items) out.push(label(item));
  }
  return out;
};

/** A route written as one object rather than as a path and a handler. */
const objectRouteOf = (site: AppCall, dialect: RouteDialect, ctx: ExtractContext): Route | undefined => {
  const shape = dialect.routeObject;
  if (shape === undefined || site.method !== shape.method) return undefined;
  const written = site.args[0];
  if (written === undefined) return undefined;
  const verbs = verbsArg(propertyOf(written, shape.verbKey));
  const path = stringArg(propertyOf(written, shape.pathKey));
  if (verbs === undefined || path === undefined) return undefined;
  const handlerArg = throughWrapper(propertyOf(written, shape.handlerKey));
  return {
    verbs,
    path,
    middleware: optionMiddleware(written, dialect),
    answer: answered(site, handlerArg, verbs, path, ctx),
  };
};

/**
 * Which argument of a verb call spells the path.
 *
 * The dialect says where the path sits among a route's own arguments; a method
 * that takes the verb as an argument has one more in front of all of them, and
 * that shift belongs to the reader rather than to a second field nobody could
 * fill without knowing about the first.
 */
const pathIndex = (site: AppCall, dialect: RouteDialect): number =>
  (dialect.verbArgument !== undefined && site.method === dialect.verbArgument ? 1 : 0) +
  dialect.pathAt;

const routeOf = (site: AppCall, dialect: RouteDialect, ctx: ExtractContext): Route | undefined => {
  const asObject = objectRouteOf(site, dialect, ctx);
  if (asObject !== undefined) return asObject;

  const byArgument = dialect.verbArgument !== undefined && site.method === dialect.verbArgument;
  const verb = dialect.verbs[site.method];
  if (verb === undefined && !byArgument) return undefined;
  const pathAt = pathIndex(site, dialect);
  // One argument is a path with nothing to answer it, which the framework
  // accepts and which declares no way in. It is also how Express reads a
  // setting back: `app.get('trust proxy')`.
  if (site.args.length < pathAt + 2) return undefined;

  const verbs = byArgument ? verbsArg(site.args[0]) : [verb as string];
  if (verbs === undefined) return undefined;
  const path = stringArg(site.args[pathAt]);
  if (path === undefined) return undefined;

  // Where the answer sits is the dialect's to say, and the arguments between it
  // and the path are the middleware written for this one route.
  const handlerAt =
    dialect.handlerAt < 0 ? site.args.length + dialect.handlerAt : dialect.handlerAt;
  if (handlerAt <= pathAt) return undefined;
  const handlerArg = throughWrapper(site.args[handlerAt]);
  const middleware: string[] = [];
  for (const argument of dialect.middlewareBetween ? site.args.slice(pathAt + 1, handlerAt) : []) {
    // An options object between the path and the handler is not middleware
    // itself; some of its keys hold middleware, and only a dialect that says
    // which ones is read for them.
    if (dialect.middleware?.optionKeys !== undefined && Node.isObjectLiteralExpression(unwrap(argument))) {
      middleware.push(...optionMiddleware(argument, dialect));
      continue;
    }
    middleware.push(label(argument));
  }

  return { verbs, path, middleware, answer: answered(site, handlerArg, verbs, path, ctx) };
};

/**
 * The answer, with a node of its own for a function written in the call.
 *
 * Named for the route as it is declared rather than as it is served: the label
 * is how a reader finds the function again in the file it is written in, and
 * that file knows nothing about where the application it is on was mounted.
 */
const answered = (
  site: AppCall,
  handlerArg: TsNode | undefined,
  verbs: readonly string[],
  path: string,
  ctx: ExtractContext,
): Answer => {
  const answer = answerOf(site.call, handlerArg, ctx);
  if (answer.via !== 'inline') return answer;
  // A function written in place is still the code that runs, and a node of its
  // own is what lets a walk from the route go on into it.
  const inline = inlineHandlerOf(handlerArg, `${verbs.join('|')} ${path}`, ctx);
  return inline === undefined ? answer : { ...answer, handler: inline };
};

/**
 * Whether a registration is written under a condition.
 *
 * `if (TUS_ENABLED) app.use('/files/tus', tusRouter)` declares a route that may
 * not be there. It is still declared here and still the only place it is
 * declared, so it is read — but a reader asking why a request 404s deserves to
 * know the registration is behind a flag, so the entry says so rather than
 * claiming the route is unconditional.
 */
const isConditional = (call: TsNode): boolean => {
  for (let at = call.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isIfStatement(at) || Node.isConditionalExpression(at)) return true;
    if (Node.isBinaryExpression(at)) {
      const operator = at.getOperatorToken().getKind();
      if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
        return true;
      }
    }
    if (
      Node.isSourceFile(at) ||
      Node.isFunctionDeclaration(at) ||
      Node.isArrowFunction(at) ||
      Node.isFunctionExpression(at) ||
      Node.isMethodDeclaration(at)
    ) {
      return false;
    }
  }
  return false;
};

/**
 * Routes declared by calling the application.
 *
 * A route is a route whoever declared it, so these are ordinary `http` entry
 * points, with the verb and the path exactly as the framework will serve them —
 * any prefix the path carries included, since it is written in the path rather
 * than added at start-up.
 *
 * The receiver's type is the only thing separating this from any other object
 * with a method called `get`, which is a great many objects, and the type has to
 * be the application rather than merely from the same package.
 *
 * One reader for every framework on the table. What it does is the same in all
 * of them; what the methods are called, and which argument is which, is read
 * off the row rather than written into the code.
 */
export interface CallRoutesOptions {
  /**
   * Whether reading nothing is worth a row of its own.
   *
   * Off for the frameworks shipped with the tool: one of their adapters is
   * turned on by a dependency, and a repository that depends on a framework and
   * declares no route on it is an ordinary thing — a library, a worker, a
   * service whose routes are all in another repository. On for a framework
   * somebody described, because there the silence is the failure mode: a
   * description with a type name spelled wrong reads exactly like a repository
   * with no routes in it, and nothing else would ever say which it was.
   */
  readonly reportSilence?: boolean;
}

export const callRoutesAdapter = (
  dialect: RouteDialect,
  options: CallRoutesOptions = {},
): EntryAdapter => ({
  name: dialect.name,
  // These frameworks answer before the application the extractor reads is asked
  // anything — a worker in front of it, or no such application at all — so its
  // guards and pipes never run for them and none are drawn.
  outsideApplication: true,
  detect: (pkg) => hasAnyDependency(pkg, dialect.packages),
  extractEntries: (ctx: ExtractContext) => {
    const sources = [...repoSources(ctx)];
    const applications = new Applications(dialect, ctx);
    for (const sourceFile of sources) {
      for (const site of appCallsIn(sourceFile, dialect, ctx)) applications.collect(site);
    }

    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const anonymous: Site[] = [];
    // Calls written on a value of a type the dialect names, whether or not any
    // of them turned out to be a route. It is the one fact that tells a
    // description whose types match nothing from one whose types match and
    // whose verbs do not, and only this walk has it.
    let onDescribedType = 0;

    for (const sourceFile of sources) {
      for (const site of appCallsIn(sourceFile, dialect, ctx)) {
        onDescribedType += 1;
        const route = routeOf(site, dialect, ctx);
        if (route === undefined) {
          reportUnreadable(ctx, site, dialect);
          continue;
        }

        const { file, line } = site.site;
        // Where nothing in the repository moves an application, every one of
        // them serves what it declares, so an application handed in as an
        // argument needs no caller to be found before its routes can be placed.
        const contexts =
          applications.contextsOf(site.receiver) ?? (applications.shifts ? undefined : [ROOT]);
        if (contexts === undefined) {
          ctx.builder.addUnresolved({
            file,
            line,
            reason: 'route-path-dynamic',
            message: `${label(site.receiver)} is mounted somewhere this cannot read, so ${route.path} is not the path it is served at.`,
            hint: 'Mount the application at a literal path, or declare its routes on the application that is served.',
            symbol: `${route.verbs.join(',')} ${route.path}`,
            adapter: dialect.name,
          });
          continue;
        }

        if (route.answer.via === 'inline' && route.answer.handler === undefined) {
          anonymous.push(site.site);
        }
        const conditional = isConditional(site.call);
        const own = appOwner(site.receiver, dialect);

        for (const context of contexts) {
          const rawPath = joinPath(context.prefix, route.path);
          const path = normalizePath(rawPath);
          // Order is what the framework applies: everything inherited from
          // above the mount, then what this application installed before this
          // line, then what this one line asks for.
          const middleware = [
            ...context.guards,
            ...applications.guardsOn(own, site.site, context.prefix),
          ]
            .filter((install) => covers(install.at, rawPath))
            .flatMap((install) => install.names)
            .concat(route.middleware);

          for (const method of route.verbs) {
            const key = makeHttpEntryKey(method, path);
            const id = makeEntryId(ctx.repo, 'http', key);
            if (seen.has(id)) continue;
            seen.add(id);

            entries.push({
              id,
              kind: 'http',
              label: `${method} ${path}`,
              key,
              ...(route.answer.handler === undefined ? {} : { handler: route.answer.handler }),
              file,
              line,
              meta: {
                method,
                path,
                rawPath,
                adapter: dialect.name,
                registration: site.as ?? `${label(site.receiver)}.${site.method}`,
                // Whether the middleware list above is the whole of what stands
                // in front of this route, or only what the declaration itself
                // named. A dialect describing where installs are written has
                // had them read, mounts and all; one that does not describe
                // them has not, and the audit must not claim a guard it never
                // looked for — nor, once it does look, go on warning that it
                // did not.
                middlewareRead: dialect.middleware !== undefined,
                ...(middleware.length > 0 ? { middleware } : {}),
                ...(conditional ? { conditional: true } : {}),
                // Said plainly, because a walk from this entry is only as narrow
                // as the answer to "which code does the handler run".
                handlerVia: route.answer.via,
              },
            });
          }
        }
      }
    }

    if (anonymous.length > 0) reportAnonymous(ctx, anonymous, dialect);
    if (options.reportSilence === true && entries.length === 0) {
      reportSilence(ctx, dialect, onDescribedType);
    }
    return entries;
  },
});

/**
 * A description that read nothing, and which part of it read nothing.
 *
 * The failure mode of every configuration-driven reader is silence that looks
 * like a clean repository, and the two silences want different answers. No call
 * on any described type means the description is pointed at the wrong types —
 * the commonest cause being a framework whose application type is re-exported
 * from a package the repository does not import it from. Calls on the right
 * types and no route out of them means the types are right and the methods or
 * the argument positions are not.
 *
 * Written against the manifest, because that is the nearest real file: the
 * description itself is in the project's configuration, which is not part of
 * the repository the row belongs to.
 */
const reportSilence = (ctx: ExtractContext, dialect: RouteDialect, onTypes: number): void => {
  const types = dialect.appTypes.map((app) => `${app.package}#${app.typeName}`).join(', ');
  const verbs = Object.keys(dialect.verbs).join(', ');
  ctx.builder.addUnresolved({
    file: 'package.json',
    line: 1,
    reason: onTypes === 0 ? 'entry-http-types-unmatched' : 'entry-http-routes-unmatched',
    message:
      onTypes === 0
        ? `Nothing here is a value of any type the ${dialect.name} description names, so none of its routes were read.`
        : `${onTypes} call${onTypes === 1 ? ' is' : 's are'} written on a type the ${dialect.name} description names, and none of them spelled a verb and a path this could read.`,
    hint:
      onTypes === 0
        ? `Check appTypes on that description; it looks for ${types}.`
        : `Check verbs, verbArgument, pathArg and handlerArg on that description; it looks for ${verbs}.`,
    symbol: dialect.name,
    adapter: dialect.name,
  });
};

/**
 * A route whose path or verb could not be read.
 *
 * Only for calls that really are route declarations: `use` installs middleware
 * or mounts a router and `notFound` installs a last resort, and none of them is
 * a way in that anything could ask for by name.
 */
const reportUnreadable = (ctx: ExtractContext, site: AppCall, dialect: RouteDialect): void => {
  const byArgument = dialect.verbArgument !== undefined && site.method === dialect.verbArgument;
  const asObject =
    dialect.routeObject !== undefined &&
    site.method === dialect.routeObject.method &&
    site.args[0] !== undefined &&
    Node.isObjectLiteralExpression(unwrap(site.args[0] as TsNode));
  if (dialect.verbs[site.method] === undefined && !byArgument && !asObject) return;
  const pathAt = pathIndex(site, dialect);
  if (!asObject && site.args.length < pathAt + 2) return;
  const written = asObject
    ? propertyOf(site.args[0], dialect.routeObject?.pathKey ?? '')
    : site.args[pathAt];

  ctx.builder.addUnresolved({
    file: site.site.file,
    line: site.site.line,
    reason: 'route-path-dynamic',
    hint: DYNAMIC_PATH_HINT,
    symbol: `${label(site.receiver)}.${site.method}(${label(written)})`,
    adapter: dialect.name,
  });
};

/**
 * Routes whose handler is written in the call and hands over to nothing named.
 *
 * Informational, and counted rather than listed: a function written in the
 * registration is the ordinary way to write a route, so a row per site would be
 * the tool describing its own limits once for every route in the repository
 * (R07). The way in is real and keeps its node either way; what is missing is
 * only the edge to what answers it.
 */
const reportAnonymous = (
  ctx: ExtractContext,
  sites: readonly Site[],
  dialect: RouteDialect,
): void => {
  const first = [...sites].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  )[0] as Site;
  const count = sites.length;
  ctx.builder.addUnresolved({
    file: first.file,
    line: first.line,
    reason: 'route-handler-anonymous',
    level: 'info',
    sites: count,
    message: `${count} route${count === 1 ? '' : 's'} answer with a function written in the declaration, so nothing can be pointed at as the code behind them.`,
    hint: 'Give the handler a name and register that, or have the one written in place return what a single named function answers with.',
    symbol: dialect.packages[0] as string,
    adapter: dialect.name,
  });
};

export const expressRoutesAdapter = callRoutesAdapter(EXPRESS);
export const fastifyRoutesAdapter = callRoutesAdapter(FASTIFY);
export const koaRoutesAdapter = callRoutesAdapter(KOA);
export const honoRoutesAdapter = callRoutesAdapter(HONO);
