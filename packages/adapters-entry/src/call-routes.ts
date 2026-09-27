import type {
  EntryAdapter,
  EntryHandler,
  EntryNode,
  EntryWrapping,
  ExtractContext,
} from '@flowatlas/core';
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
import { EXPRESS, FASTIFY, HONO, KOA, MOUNT_HELPERS } from './route-dialects.js';
import { Registries, registryOf } from './route-registries.js';
import {
  enclosingClass,
  fileOfNode,
  handlerOfFunction,
  handlerReturned,
  inlineHandlerOf,
  joinPath,
  packageOfCall,
  repoFunctionOf,
  repoSources,
} from './shared.js';

/**
 * The sentence for a route whose own path could not be read.
 *
 * Rewritten after R101 made a list of paths and a chained `.route(path)` read:
 * the old one asked for "a string literal or a const string", which a list of
 * paths is not and does not need to be, and called the path "computed" when
 * `'/api/' + VERSION` is computed and reads in full. What does not read is a
 * piece that takes a call or a run-time value, one of them anywhere in a list
 * drops the whole registration, and the route is then missing rather than
 * merely unmatched.
 */
const DYNAMIC_PATH_HINT =
  'Write the path as a literal, a const, or a + or template of them, and every path of a list the same way; a path that needs a call or a run-time value to compute is not recorded as a route at all, so no caller can reach it.';

/**
 * What to do about a route on an application whose base could not be read.
 *
 * Two sentences rather than one, because the old single sentence told a great
 * many people to do what they had already done: outline mounts its applications
 * at literal paths, through a helper, and was asked to mount them at literal
 * paths. Where the helper is known the row names it, which is the one fact that
 * turns the row into something somebody can act on; where the application
 * arrives as a parameter or through a directory loader there is no call to name,
 * and the older sentence is still the right one.
 */
const unplacedHint = (helper: string | undefined): string =>
  helper === undefined
    ? 'Mount the application at a literal path, or declare its routes on the application that is served.'
    : `The path is an argument of ${helper}, a mount helper this tool has no record of. Mount the application with the framework's own method and a literal path, or have that helper described.`;

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

/**
 * The paths a call was given, as written: one, or a list of them.
 *
 * `router.get(['/items/:id', '/i/:id'], handler)` is legal Express and declares
 * two addresses, both of which a caller may ask for. The verbs beside this were
 * folded from the day they were read; the paths were not, so one of those calls
 * read as a route whose path could not be told — a row in the report and two
 * addresses missing from the graph (R101).
 */
const pathsArg = (argument: TsNode | undefined): string[] | undefined => {
  if (argument === undefined) return undefined;
  const value = evaluateExpression(argument);
  if (!value.resolved) return undefined;
  const raw = Array.isArray(value.value) ? value.value : [value.value];
  const paths: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return undefined;
    paths.push(item);
  }
  return paths.length > 0 ? paths : undefined;
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
    if (!dialect.verbs.has(method)) return undefined;
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
    const chained = dialect.verbs.has(method) ? chainedRoute(receiver, dialect) : undefined;
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
 * An application hung inside another by a helper, and where the helper put it.
 *
 * `app.use(mount('/api', api))` — `koa-mount` takes a prefix and an application
 * and hands back middleware, so the argument of `use` is not an application and
 * `mountedApp` above says nothing was mounted. The line then read as an ordinary
 * middleware install: the prefix was dropped, and every route under it kept the
 * address it is written at. On outline that was 253 of 257 routes recorded at an
 * address nothing serves, with no row anywhere to say so (R84).
 *
 * Two answers, and which one a repository gets is decided by a record rather
 * than by a condition. A helper this tool has a `MOUNT_HELPERS` row for is read
 * whole: the row says which argument is the application and which spells the
 * prefix, and the mount is placed. A helper nobody described is read as far as
 * it can be — the application is found among the arguments and the mount has no
 * path — so a route under it is reported as mounted somewhere this cannot read,
 * which is a missing address instead of a wrong one: the first can be acted on,
 * the second joins to callers that do not exist (R110).
 *
 * The application the call is written on is not an answer. `app.use(session(app))`
 * hands a middleware factory the very application it is being installed on, which
 * is ordinary and mounts nothing; reading it as a mount would make every route in
 * such a repository unplaceable.
 */
interface HelperMount {
  readonly declaration: TsNode;
  /** Absent where nobody described the helper, or where it spells no readable path. */
  readonly at?: string;
}

/** Reads the one and the other; see the note above. */
const helperMount = (
  argument: TsNode | undefined,
  receiver: TsNode,
  dialect: RouteDialect,
): HelperMount | undefined => {
  if (argument === undefined) return undefined;
  const node = unwrap(argument);
  if (!Node.isCallExpression(node)) return undefined;
  const own = appDeclaration(receiver);
  const mounted = (written: TsNode | undefined): TsNode | undefined => {
    if (written === undefined) return undefined;
    const value = unwrap(written);
    if (!isApp(value, dialect)) return undefined;
    const declaration = appDeclaration(value);
    return declaration !== undefined && declaration !== own ? declaration : undefined;
  };

  const args = node.getArguments();
  const pkg = packageOfCall(node);
  const described = pkg === undefined ? undefined : MOUNT_HELPERS.get(pkg);
  if (described !== undefined) {
    const written = argumentAt(args, described.appAt);
    const declaration = mounted(written);
    if (declaration !== undefined) {
      const spelled = argumentAt(args, described.pathAt);
      // A helper handed the application alone puts it at its parent's base:
      // `mount(routes)`, which outline writes beside four mounts that name a
      // prefix. The application sitting in the prefix's position is how that is
      // spelled, and it is an answer rather than an absence.
      const at = spelled === undefined || spelled === written ? '' : stringArg(spelled);
      return { declaration, ...(at === undefined ? {} : { at }) };
    }
  }

  for (const written of args) {
    const declaration = mounted(written);
    if (declaration !== undefined) return { declaration };
  }
  return undefined;
};

/**
 * What a router turns itself into, taken back off again.
 *
 * `hook.value.routes()` is the middleware a Koa router hands back, and what the
 * collection holds is the router. `mountedApp` strips the same call when it is
 * written on something it can follow; this is that step for a member of a
 * collection, which nothing can follow yet.
 */
const stripThrough = (node: TsNode, through: readonly string[] | undefined): TsNode => {
  if (through === undefined || !Node.isCallExpression(node)) return node;
  const callee = node.getExpression();
  return Node.isPropertyAccessExpression(callee) && through.includes(callee.getName())
    ? unwrap(callee.getExpression())
    : node;
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
 * The value written for a declaration, wherever a declaration can carry one.
 *
 * A parameter's default is one of them, and it is the one that earns this its own
 * function. `export default function init(app: Koa = new Koa(), server?: Server)`
 * is how outline's web service declares the application every one of its routes
 * is served on: the service is started through a map of dynamic imports, so no
 * call to `init` can be followed from here, and the default is the only statement
 * in the repository about what `app` is.
 *
 * Read as the parameter's value, with the same walk a `const` gets, because it is
 * the same kind of fact and it is better evidence than what stood here before: a
 * parameter with no value read at all falls back to the root of the service where
 * the repository moves nothing, which is a guess, and to nothing where it does,
 * which lost every address under a mount the reader had just learned to follow. A
 * caller handing in a sub-application instead would make the default the wrong
 * answer; a caller who writes `= new Koa()` has said the function may own the
 * application, and the address is then read from the mounts as usual.
 */
const valueWritten = (declaration: TsNode): TsNode | undefined =>
  Node.isVariableDeclaration(declaration) ||
  Node.isPropertyDeclaration(declaration) ||
  Node.isParameterDeclaration(declaration)
    ? declaration.getInitializer()
    : undefined;

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
  dialect.verbs.has(method);

/**
 * Whether a call answers with an application of the kind the row names.
 *
 * The methods above are the ones a description names, and no description can
 * name them all: `const app = express().disable('x-powered-by')` is the ordinary
 * declaration of an application with one setting turned off, and `disable` is not
 * a mount, an install or a verb. PeerTube writes that line once, and every one of
 * its 344 routes was then declared on something the reader could not place, under
 * a hint telling whoever read the report to mount the application at a literal
 * path — which the line below it already did (R101).
 *
 * Asked of the type rather than of a list of method names, because a method
 * answering with an application of the same kind *is* that application as far as
 * an address goes, and the alternative is a list of every setter four frameworks
 * have. A prefix method is excluded by its caller and not here: Hono's `basePath`
 * answers with an application of the same type and a different base, which is the
 * one case where the type says less than the row does.
 */
const answersWithApp = (call: TsNode, dialect: RouteDialect): boolean =>
  Node.isCallExpression(call) && isApp(call, dialect);

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
    const method = callee.getName();
    const through =
      passesThrough(method, dialect) ||
      (method !== dialect.prefixMethod && answersWithApp(at, dialect));
    if (!through) break;
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
  /** The call that installed it, as written, for the edge to say where it came from. */
  source: string;
}

/** Where one application is reached, and what stands in front of it there. */
interface RouteContext {
  prefix: string;
  guards: readonly Install[];
}

const ROOT: RouteContext = { prefix: '', guards: [] };

/** The fixed part of a path an install is scoped to, with any wildcard tail cut. */
const baseOf = (at: string): string => at.replace(/\/?\*+$/, '');

/** Whether middleware scoped to a path covers a route served at another. */
const covers = (at: string | undefined, path: string): boolean => {
  if (at === undefined) return true;
  const base = baseOf(at);
  return base === '' || base === '/' || path === base || path.startsWith(`${base}/`);
};

/**
 * How wide an install is: the whole application, or one prefix of it.
 *
 * `use('*', …)` and `use(…)` are the same installation written two ways, and
 * both are read as global, by the same reading of the path `covers` uses. A
 * scope that said `prefix` for a wildcard would be a difference in the graph
 * where there is none in the code.
 */
const scopeOf = (at: string | undefined): 'global' | 'prefix' => {
  if (at === undefined) return 'global';
  const base = baseOf(at);
  return base === '' || base === '/' ? 'global' : 'prefix';
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
  /**
   * The helper call that hid the path, when a helper nobody described did.
   *
   * Kept so the row about a route underneath can name it. A reader told that an
   * application is mounted somewhere unreadable, and asked to mount it at a
   * literal path, has nothing to act on when the literal path is right there in
   * a call the tool has no record of — and every such reader had already done
   * what the hint asked.
   */
  through?: string;
}

/**
 * A collection of applications mounted whole, which nothing here could read.
 *
 * The mechanism is worth a row of its own because it is the one way in that is
 * registered once for an unknown number of ways in: the routes missing are not
 * the routes of one application but of however many something put into the
 * collection, and a reader that said nothing would be a reader claiming the
 * repository serves what it happened to find written on an application.
 */
interface UnreadRegistry {
  /** The collection and the keys the mount read off a member of it. */
  registry: string;
  /** The mount that installed them, as it is written. */
  through: string;
  site: Site;
  /** The path the mount gives them, when it spells one. */
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
  readonly #registries: Registries;
  readonly #mounts = new Map<TsNode, Mount[]>();
  readonly #installs = new Map<TsNode, Install[]>();
  /** Prefixes a mutating prefix call put in front of a whole router. */
  readonly #shifted = new Map<TsNode, string | undefined>();
  /** Collections mounted whole, whose members nothing here could enumerate. */
  readonly #unread = new Map<string, UnreadRegistry>();
  #shifts = false;

  constructor(dialect: RouteDialect, ctx: ExtractContext, registries: Registries) {
    this.#dialect = dialect;
    this.#ctx = ctx;
    this.#registries = registries;
  }

  get shifts(): boolean {
    return this.#shifts;
  }

  get unreadRegistries(): readonly UnreadRegistry[] {
    return [...this.#unread.values()];
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
    // Asked before an application is looked for, because a member of a
    // collection is not a value this could follow and following it anyway lands
    // somewhere worse than nowhere: `hook.value` resolves to the *type* the
    // collection is declared with, so the mount was recorded against a property
    // of an interface, nothing was ever mounted, and every route under it kept
    // the address it is written at with no row to say so.
    if (this.#collectRegistry(site, mount, written)) return true;
    const seenThrough = mountedApp(written, mount, this.#dialect);
    // A helper between the mount and the application hides the path and nothing
    // else: the application is still being hung somewhere, so it is recorded
    // there — at the path the helper's own row says it put it, or with no path
    // at all where no row describes the helper.
    const helper =
      seenThrough === undefined ? helperMount(written, site.receiver, this.#dialect) : undefined;
    const declaration = seenThrough ?? helper?.declaration;
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
    // The path of a mount written through a helper is inside the helper's own
    // arguments, under whatever meaning the helper gives them. Reading the
    // argument position this framework describes would find the helper call
    // itself, which is not a path, and `#mountPath` answers "no path given" to
    // that — the parent's base, which is precisely the wrong address a mount
    // through a helper must not be recorded at.
    const at = helper === undefined ? this.#mountPath(site, mount) : helper.at;
    const empty =
      Node.isVariableDeclaration(declaration) && declaration.getInitializer() === undefined;
    for (const target of [declaration, ...(empty ? assignedApps(declaration, this.#dialect) : [])]) {
      const found = this.#mounts.get(target) ?? [];
      found.push({
        parent: site.receiver,
        site: site.site,
        ...(at === undefined ? {} : { at }),
        ...(at === undefined && helper !== undefined ? { through: label(written) } : {}),
      });
      this.#mounts.set(target, found);
    }
    return true;
  }

  /**
   * A mount whose application is one member of a collection.
   *
   * True when the call was one, whether or not the collection could be read,
   * because either way it is a mount and not a middleware install and either way
   * it moves applications: the thing this must not do is let the line read as
   * ordinary middleware and leave the routes under it at the addresses they are
   * written at.
   *
   * Every member that is an application of this framework is mounted here, at
   * the path this mount gives it. That the collection may hold other things is
   * not a guess being made: the keys the mount itself read are the filter, and a
   * value reached by them that is an application of the framework being read *is*
   * one of the applications this line installs.
   */
  #collectRegistry(site: AppCall, mount: MountShape, written: TsNode | undefined): boolean {
    if (written === undefined) return false;
    const registry = registryOf(stripThrough(unwrap(written), mount.through));
    if (registry === undefined) return false;
    this.#shifts = true;
    const at = this.#mountPath(site, mount);
    const found = new Set<TsNode>();
    for (const member of this.#registries.membersOf(registry)) {
      if (!isApp(member, this.#dialect)) continue;
      const declaration = appDeclaration(member);
      if (declaration !== undefined) found.add(declaration);
    }
    const named = `${label(registry.source)}${registry.at.map((key) => `.${key}`).join('')}`;
    const through = `${label(site.receiver)}.${site.method}`;
    if (found.size === 0) {
      // One row for the collection and the mount, and not one per member: there
      // are no members to write a row about, which is the whole of what the row
      // has to say.
      this.#unread.set(`${named}\u0000${through}`, {
        registry: named,
        through,
        site: site.site,
        ...(at === undefined ? {} : { at }),
      });
      return true;
    }
    for (const target of found) {
      const mounts = this.#mounts.get(target) ?? [];
      mounts.push({ parent: site.receiver, site: site.site, ...(at === undefined ? {} : { at }) });
      this.#mounts.set(target, mounts);
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
      source: `${label(site.receiver)}.${site.method}`,
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
   * The undescribed helper that hid the path of a mount above an application.
   *
   * Asked only once a route has turned out to be unplaceable, and answered by
   * walking the mounts upwards, because the mount that defeated the reading is
   * rarely the one written on the application the route is declared on: outline
   * mounts a router on an application and that application through the helper,
   * two files apart. The first helper found on the way up is the one to name —
   * there is no second address to be had by looking further, and naming the
   * nearest one is what tells somebody which call to look inside.
   */
  helperAbove(declaration: TsNode | undefined, seen: Set<TsNode> = new Set()): string | undefined {
    if (declaration === undefined || seen.has(declaration)) return undefined;
    seen.add(declaration);
    for (const mount of this.#mounts.get(declaration) ?? []) {
      if (mount.through !== undefined) return mount.through;
      const above = this.helperAbove(appOwner(mount.parent, this.#dialect), seen);
      if (above !== undefined) return above;
    }
    return undefined;
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
          // A method no row names, answering with an application of the same
          // kind: the chain is one declaration of one application, and what is
          // written on it is written on what it came from.
          if (answersWithApp(node, dialect)) return inner;
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

    const initializer = valueWritten(declaration);
    // A binding whose value is not written here: the base is whatever the caller
    // had, which only the caller knows.
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
  /**
   * Every address this one registration serves.
   *
   * Usually one. A list where the call was given a list: both a list of verbs
   * and a list of paths are one declaration of several ways in, and a reader
   * that folded the first and not the second read half of such a call.
   */
  paths: string[];
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
  const paths = pathsArg(propertyOf(written, shape.pathKey));
  if (verbs === undefined || paths === undefined) return undefined;
  const handlerArg = throughWrapper(propertyOf(written, shape.handlerKey));
  return {
    verbs,
    paths,
    middleware: optionMiddleware(written, dialect),
    answer: answered(site, handlerArg, verbs, paths, ctx),
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
  const verb = dialect.verbs.get(site.method);
  if (verb === undefined && !byArgument) return undefined;
  const pathAt = pathIndex(site, dialect);
  // One argument is a path with nothing to answer it, which the framework
  // accepts and which declares no way in. It is also how Express reads a
  // setting back: `app.get('trust proxy')`.
  if (site.args.length < pathAt + 2) return undefined;

  const verbs = byArgument ? verbsArg(site.args[0]) : [verb as string];
  if (verbs === undefined) return undefined;
  const paths = pathsArg(site.args[pathAt]);
  if (paths === undefined) return undefined;

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

  return { verbs, paths, middleware, answer: answered(site, handlerArg, verbs, paths, ctx) };
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
  paths: readonly string[],
  ctx: ExtractContext,
): Answer => {
  const answer = answerOf(site.call, handlerArg, ctx);
  if (answer.via !== 'inline') return answer;
  // A function written in place is still the code that runs, and a node of its
  // own is what lets a walk from the route go on into it. One function answers
  // every address the registration named, so every one of them is in its name.
  const inline = inlineHandlerOf(handlerArg, `${verbs.join('|')} ${paths.join('|')}`, ctx);
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
   * Whether reading nothing is something somebody should act on.
   *
   * Reading nothing is always worth a row. It was not always: the row was
   * written only for a framework somebody described, on the argument that a
   * repository depending on a framework and declaring no route on it is an
   * ordinary thing — a library, a worker, a service whose routes live
   * elsewhere. True, and it left medusa measured at 769 of 791 source files
   * producing no node with nothing anywhere saying so, because a file-system
   * router reads exactly like a library from in here (R84). The reader cannot
   * tell those two apart, and the one it must not do is stay quiet about which
   * it was looking at.
   *
   * So the difference is the level rather than the row. On for a description
   * somebody wrote, where silence is a mistake with a fix — a type name spelled
   * wrong reads exactly like a clean repository. Off for a framework shipped
   * with the tool, where it is a limit of this reading and the reader is saying
   * so rather than asking for anything.
   *
   * Reading *some* of something is the same question, and it went unasked for
   * longer: a reading that placed three routes out of three hundred and forty
   * said nothing at all, because the row asked whether the count was zero (R91,
   * R121). It is a row now under the same rule, and `reportSilence` decides its
   * level for the same reason — see `reportRead`.
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
    const applications = new Applications(dialect, ctx, new Registries(sources));
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
    // Calls that really were route declarations, and the ones of those whose
    // address could be told. The difference between them is what makes a partial
    // read a gap rather than a lie: a reader that found three routes and could
    // not place three hundred used to say nothing at all, because the one row it
    // had asked whether the count was zero (R91).
    let declared = 0;
    let addressed = 0;

    for (const sourceFile of sources) {
      for (const site of appCallsIn(sourceFile, dialect, ctx)) {
        onDescribedType += 1;
        const route = routeOf(site, dialect, ctx);
        if (route === undefined) {
          reportUnreadable(ctx, site, dialect);
          continue;
        }
        declared += 1;

        const { file, line } = site.site;
        /** How the route was registered, as a reader would find it in the file. */
        const registration = site.as ?? `${label(site.receiver)}.${site.method}`;
        // Where nothing in the repository moves an application, every one of
        // them serves what it declares, so an application handed in as an
        // argument needs no caller to be found before its routes can be placed.
        const own = appOwner(site.receiver, dialect);
        const contexts =
          applications.contextsOf(site.receiver) ?? (applications.shifts ? undefined : [ROOT]);
        if (contexts === undefined) {
          // A reason of its own, because the route's own path was read: what
          // could not be is the path its application was mounted under, which
          // is fixed somewhere else and by someone else. `route-path-dynamic`
          // is the route's own path being computed, and a person silencing one
          // of the two has not said anything about the other (R110).
          ctx.builder.addUnresolved({
            file,
            line,
            reason: 'route-mount-unread',
            message: `${label(site.receiver)} is mounted somewhere this cannot read, so ${route.paths.join(', ')} is not the path it is served at.`,
            hint: unplacedHint(applications.helperAbove(own)),
            symbol: `${route.verbs.join(',')} ${route.paths.join(',')}`,
            adapter: dialect.name,
          });
          continue;
        }
        addressed += 1;

        if (route.answer.via === 'inline' && route.answer.handler === undefined) {
          anonymous.push(site.site);
        }
        const conditional = isConditional(site.call);

        // One entry for each address, at each place the application is reached: a
        // registration given two paths on an application mounted twice is four
        // ways in, and every one of them is a way in a caller may ask for.
        const placed = contexts.flatMap((context) =>
          route.paths.map((declared) => ({ context, declared })),
        );
        for (const { context, declared } of placed) {
          const rawPath = joinPath(context.prefix, declared);
          const path = normalizePath(rawPath);
          // Order is what the framework applies: everything inherited from
          // above the mount, then what this application installed before this
          // line, then what this one line asks for.
          //
          // Described, not listed: each one becomes a node and a `guarded_by`
          // edge in the order it runs, which is the same shape a decorator-driven
          // reader draws. A list on the entry read as an unguarded route to
          // everything that reads the graph as a graph (R109).
          const installed = [
            ...context.guards,
            ...applications.guardsOn(own, site.site, context.prefix),
          ].filter((install) => covers(install.at, rawPath));
          const wrapping: EntryWrapping[] = [
            ...installed.flatMap((install) =>
              install.names.map((name) => ({
                label: name,
                layer: 'middleware' as const,
                scope: scopeOf(install.at),
                source: install.source,
                file: install.site.file,
                line: install.site.line,
                kind: 'function',
              })),
            ),
            ...route.middleware.map((name) => ({
              label: name,
              layer: 'middleware' as const,
              scope: 'route' as const,
              source: registration,
              file,
              line,
              kind: 'function',
            })),
          ];

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
              ...(wrapping.length > 0 ? { wrapping } : {}),
              meta: {
                method,
                path,
                rawPath,
                adapter: dialect.name,
                registration,
                // Whether the middleware list above is the whole of what stands
                // in front of this route, or only what the declaration itself
                // named. A dialect describing where installs are written has
                // had them read, mounts and all; one that does not describe
                // them has not, and the audit must not claim a guard it never
                // looked for — nor, once it does look, go on warning that it
                // did not.
                middlewareRead: dialect.middleware !== undefined,
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
    for (const unread of applications.unreadRegistries) reportRegistry(ctx, unread, dialect);
    reportRead(
      ctx,
      dialect,
      { onTypes: onDescribedType, declared, placed: addressed },
      options.reportSilence === true,
    );
    return entries;
  },
});

/**
 * What one dialect's reading of a repository came to, when that is worth a row.
 *
 * One reporter and one judgement, because the three things it can say are three
 * answers to the same question — how much of what this reader was looking at did
 * it come away with — and asking that question in three places is how two of the
 * answers came to disagree.
 *
 * - **No call on any described type.** The description is pointed at the wrong
 *   types, the commonest cause being a framework whose application type is
 *   re-exported from a package the repository does not import it from.
 * - **Calls on the right types and no route among them.** The types are right and
 *   the methods or the argument positions are not.
 * - **Routes read and not all of them placed.** The one that was missing, and the
 *   sharpest of the three. It used to be asked as `entries.length === 0`, so a
 *   repository where three routes were placed and three hundred and thirty-seven
 *   were not looked exactly like a repository with three routes: a partial read
 *   bought silence (R91). Every one of those three hundred and thirty-seven has a
 *   row of its own already; what was missing is the sentence that says the
 *   addresses in the graph are not the addresses this service serves, and that is
 *   the difference between a gap and a lie. It generalises to every reader that
 *   can read half of something: the floor is not "did I find nothing" but "did I
 *   find everything I could see".
 *
 * Written against the manifest, because that is the nearest real file: what was
 * matched against the repository is a dependency of it and a row of description,
 * and the description itself may be in the project's configuration rather than
 * in the repository this row belongs to.
 *
 * `actionable` is whether somebody wrote the description being reported on. Where
 * they did, a gap is a spelling mistake with a fix; where the tool ships the row,
 * it is a fact about this repository that the reader is stating — the fix, if
 * there is one, is a reader for a convention nobody has written yet.
 */
interface ReadCounts {
  /** Calls written on a value of a type the dialect names. */
  readonly onTypes: number;
  /** Of those, the ones that spelled a verb and a path. */
  readonly declared: number;
  /** Of those, the ones whose address could be told. */
  readonly placed: number;
}

/** Which of the three readings a run of this reader came to. */
type Reading = 'types-unmatched' | 'routes-unmatched' | 'routes-unplaced' | 'whole';

/**
 * The one judgement, made once.
 *
 * Nothing but this decides which sentence is earned, and it is the whole of the
 * fix: the question used to be `entries.length === 0`, which is not the same
 * question and answers "whole" to a reading that placed three routes out of
 * three hundred and forty.
 */
const readingOf = ({ onTypes, declared, placed }: ReadCounts): Reading => {
  if (declared === 0) return onTypes === 0 ? 'types-unmatched' : 'routes-unmatched';
  return placed === declared ? 'whole' : 'routes-unplaced';
};

/** What each reading says, as a row, by the reading it belongs to. */
interface Said {
  readonly ctx: ExtractContext;
  readonly dialect: RouteDialect;
  readonly counts: ReadCounts;
  /** Whether somebody in this project wrote the description being reported on. */
  readonly actionable: boolean;
  /** `<name> description` or `<name> reader`, which is that same distinction. */
  readonly named: string;
  /** The first package the dialect is recognised by, for a sentence to name. */
  readonly pkg: string;
}

const READINGS: Readonly<Record<Exclude<Reading, 'whole'>, (said: Said) => void>> = {
  'types-unmatched': ({ ctx, dialect, actionable, named, pkg }) => {
    const types = dialect.appTypes.map((app) => `${app.package}#${app.typeName}`).join(', ');
    ctx.builder.addUnresolved({
      file: 'package.json',
      line: 1,
      reason: 'entry-http-types-unmatched',
      ...(actionable ? {} : { level: 'info' as const }),
      message: `Nothing here is a value of any type the ${named} names, so none of its routes were read.`,
      hint: actionable
        ? `Check appTypes on that description; it looks for ${types}.`
        : // "Somewhere this reader does not look" rather than "in a way no reader
          // here knows", which was true when it was written and is not any more: a
          // file-system convention is now described for two frameworks, and on
          // such a repository a sibling adapter has read every route while this
          // one truthfully found none. This reader cannot see what the others
          // found, so it names the possibility rather than denying it (R91).
          `Ordinary where ${pkg} is a dependency and no route is declared on it. If this repository does serve routes, they are declared somewhere this reader does not look — a file-system convention, which another reader here may have read already, or a framework of its own in front of this one.`,
      symbol: dialect.name,
      adapter: dialect.name,
    });
  },

  'routes-unmatched': ({ ctx, dialect, counts, actionable, named, pkg }) => {
    const verbs = [...dialect.verbs.keys()].join(', ');
    const { onTypes } = counts;
    ctx.builder.addUnresolved({
      file: 'package.json',
      line: 1,
      reason: 'entry-http-routes-unmatched',
      ...(actionable ? {} : { level: 'info' as const }),
      message: `${onTypes} call${onTypes === 1 ? ' is' : 's are'} written on a type the ${named} names, and none of them spelled a verb and a path this could read.`,
      hint: actionable
        ? `Check verbs, verbArgument, pathArg and handlerArg on that description; it looks for ${verbs}.`
        : `The types match and the routes do not: routes here are declared through something written around ${pkg} rather than on it, and no reader here knows that shape.`,
      symbol: dialect.name,
      adapter: dialect.name,
    });
  },

  'routes-unplaced': ({ ctx, dialect, counts, actionable, named }) => {
    const { declared, placed } = counts;
    const unplaced = declared - placed;
    ctx.builder.addUnresolved({
      file: 'package.json',
      line: 1,
      reason: 'entry-http-routes-unplaced',
      ...(actionable ? {} : { level: 'info' as const }),
      message: `${placed} of ${declared} route${declared === 1 ? '' : 's'} the ${named} read could be placed at an address; the other ${unplaced} could not, so the ways in recorded here are a part of what this service serves rather than the whole of it.`,
      hint: `Each of the ${unplaced} has a row of its own above, naming the application whose base could not be read. Until those are answered, a question this graph answers about which ways in exist is answered short.`,
      symbol: dialect.name,
      adapter: dialect.name,
    });
  },
};

const reportRead = (
  ctx: ExtractContext,
  dialect: RouteDialect,
  counts: ReadCounts,
  actionable: boolean,
): void => {
  const reading = readingOf(counts);
  if (reading === 'whole') return;
  READINGS[reading]({
    ctx,
    dialect,
    counts,
    actionable,
    named: actionable ? `${dialect.name} description` : `${dialect.name} reader`,
    pkg: dialect.packages[0] as string,
  });
};

/**
 * A collection of applications mounted whole, whose members nothing could read.
 *
 * One row, naming the collection and the mount, and never one per member —
 * there are no members to write a row about, which is precisely what the row
 * says. Before it existed the line read as an ordinary middleware install: the
 * prefix was dropped and every route of every application in the collection kept
 * the address it is written at, which is a wrong address rather than a missing
 * one.
 *
 * The path is in the row when the mount spells one, because it is the fact that
 * makes the row actionable: somebody reading it knows what is missing *and*
 * where it would have gone.
 */
const reportRegistry = (
  ctx: ExtractContext,
  unread: UnreadRegistry,
  dialect: RouteDialect,
): void => {
  const at = unread.at === undefined || unread.at === '' ? undefined : unread.at;
  ctx.builder.addUnresolved({
    file: unread.site.file,
    line: unread.site.line,
    reason: 'route-registry-unread',
    message: `${unread.through} mounts every application in ${unread.registry}${at === undefined ? '' : ` at ${at}`}, and nothing found here puts one into that collection, so however many routes it installs are missing.`,
    hint: 'Members added by a loader at run time cannot be enumerated from the source. Put the applications in a list, or register each of them on the application they are mounted on with a literal path.',
    symbol: unread.registry,
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
  if (!dialect.verbs.has(site.method) && !byArgument && !asObject) return;
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
    message:
      count === 1
        ? '1 route is answered by what a call into a package hands back, so the code behind it is not read and nothing can be pointed at as its handler.'
        : `${count} routes are answered by what a call into a package hands back, so the code behind them is not read and nothing can be pointed at as their handler.`,
    hint: 'A call such as passport.authenticate(...) returns the package\'s own function. Nothing needs fixing if that is intended; to give the route code to point at, register a function of this repository that hands over to the package.',
    symbol: dialect.packages[0] as string,
    adapter: dialect.name,
  });
};

export const expressRoutesAdapter = callRoutesAdapter(EXPRESS);
export const fastifyRoutesAdapter = callRoutesAdapter(FASTIFY);
export const koaRoutesAdapter = callRoutesAdapter(KOA);
export const honoRoutesAdapter = callRoutesAdapter(HONO);
