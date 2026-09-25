/**
 * The frameworks that register a route by calling the application, described
 * rather than implemented.
 *
 * Every one of them wants the same three things from the source — a verb, a
 * path and a handler — and differs only in what the methods are called and
 * where the arguments sit. A description per framework and one reader over all
 * of them means a new framework is a row here, read by code that has already
 * been proved against four others; an implementation per framework means four
 * copies of the mounting rules, which is where the bugs would live.
 *
 * Written from Express outwards. Express is the one with the most variation and
 * the most users, so it sets what the description has to be able to say: an
 * application that is a value rather than a class, a router mounted with the
 * same method that installs middleware, and middleware that reaches a route
 * through however many mounts lie between them. Hono, Fastify and Koa were then
 * checked against it. Where one of them needs something none of the others
 * does, the field says whose it is.
 */

/** A type whose values declare routes, or hold middleware for the ones that do. */
export interface AppType {
  readonly package: string;
  readonly typeName: string;
}

/**
 * How one application is hung inside another.
 *
 * The path the mount adds is either an argument (`app.use('/auth', router)`) or
 * a key of an options object (`app.register(routes, { prefix: '/auth' })`), and
 * the application being mounted is either a value or the parameter of a plugin
 * function the framework will call with it.
 */
export interface MountShape {
  readonly method: string;
  /** Which argument is the application; negative counts from the end. */
  readonly appAt: number;
  /** Which argument spells the path, when one does. */
  readonly pathAt?: number;
  /** The options argument and the key on it that spells the prefix. */
  readonly prefixKey?: { readonly at: number; readonly key: string };
  /**
   * The application is the first parameter of the function handed over, rather
   * than the argument itself. Fastify's, and nobody else's: a plugin is a
   * function the framework calls with an instance scoped to the prefix.
   */
  readonly asPlugin?: boolean;
  /**
   * Methods that turn an application into the middleware it is mounted as.
   * Koa's, and nobody else's: `app.use(router.routes())` mounts `router`.
   */
  readonly through?: readonly string[];
}

/**
 * How middleware is installed on a whole application rather than on one route.
 *
 * This is the guard equivalent, and the reason the shape is worth describing:
 * `app.use(authenticate)` written above thirty mounts is what stands between a
 * request and every route under all of them.
 */
export interface MiddlewareShape {
  readonly install: string;
  /** The first argument may be a path the middleware is scoped to. */
  readonly scoped?: boolean;
  /**
   * The first argument names a lifecycle hook and is not middleware itself.
   * Fastify's `addHook('preHandler', fn)`, and nobody else's.
   */
  readonly named?: boolean;
  /**
   * Keys of an options object written between the path and the handler that
   * hold middleware for that one route. Fastify's, and nobody else's: the other
   * three write route middleware as further arguments.
   */
  readonly optionKeys?: readonly string[];
}

/**
 * A route declared by one object argument rather than by position.
 *
 * Fastify's `app.route({ method, url, handler })`, and nobody else's. It is
 * here because it is the form Fastify's own documentation leads with, and a
 * repository written that way would otherwise read as having no routes at all.
 */
export interface RouteObjectShape {
  readonly method: string;
  readonly verbKey: string;
  readonly pathKey: string;
  readonly handlerKey: string;
}

export interface RouteDialect {
  /** The adapter's name, as it appears in `meta.adapter` and in every row. */
  readonly name: string;
  /** Dependencies any one of which means this framework is in use. */
  readonly packages: readonly string[];
  /** Types whose values declare routes, or carry middleware for ones that do. */
  readonly appTypes: readonly AppType[];
  /** Method name to the verb it answers. */
  readonly verbs: Readonly<Record<string, string>>;
  /** A method taking the verb as its first argument. Hono's `on`, and nobody else's. */
  readonly verbArgument?: string;
  /** A method returning the same application with a prefix in front of it. */
  readonly prefixMethod?: string;
  /**
   * The prefix method changes the application it is called on rather than
   * returning a new one, so a bare statement moves every route on it. Koa's
   * `router.prefix('/x')`, and nobody else's — Hono's `basePath` returns a new
   * application and a bare statement of it does nothing at all.
   */
  readonly prefixMutates?: boolean;
  /** A key of the constructor's options object that prefixes the whole router. */
  readonly prefixOption?: string;
  /**
   * A method returning a route object already bound to a path, on which the
   * verbs are then written: Express's `app.route('/books').get(handler)`.
   *
   * The path is declared on a type that is not the application, so nothing
   * downstream would recognise the verb call as a route at all. Naming the
   * method here is enough, because the reader rewrites the chain into the
   * ordinary positional form before anything else looks at it.
   */
  readonly pathMethod?: string;
  readonly mount?: MountShape;
  readonly middleware?: MiddlewareShape;
  readonly routeObject?: RouteObjectShape;
}

/** Every combination of a package and a type name, which is how types are listed. */
const appTypes = (
  packages: readonly string[],
  typeNames: readonly string[],
): readonly AppType[] =>
  packages.flatMap((pkg) => typeNames.map((typeName) => ({ package: pkg, typeName })));

/** The verbs every one of these frameworks spells as a method of its own. */
const COMMON_VERBS: Readonly<Record<string, string>> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  all: 'ALL',
};

/**
 * Express, and the shape the description was written to fit.
 *
 * The application is a value — `const app = express()` — created in one file and
 * configured in others, so the type on the receiver is the only thing that
 * separates `app.get('/users', …)` from any other object with a method called
 * `get`, including `app.get('trust proxy')`, which reads a setting. Two
 * arguments are required of a route for that reason as much as for any other.
 *
 * `Application` and `Router` are declared in `@types/express-serve-static-core`
 * rather than in `@types/express`, which re-exports them, so the package a type
 * comes from is that one and both have to be listed. A repository that vendors
 * its own `class ApiRouter extends Router` is read too, because the check walks
 * the base classes.
 *
 * `app.route('/books').get(handler)` declares the path on an `IRoute` rather
 * than on the application, so `pathMethod` names the method that returns it.
 * Nothing in the four repositories measured writes it, which is why it was left
 * for a while; what decided it in the end is that the failure was silent — the
 * verb call is written on a type no row mentions, so those routes were not read
 * and nothing said so. A wrong address is worse than none, and no address at
 * all with no row to say so is worse than either.
 */
export const EXPRESS: RouteDialect = {
  name: 'express-routes',
  packages: ['express', '@types/express'],
  appTypes: appTypes(
    // The last is a repository with `express` itself typed, or a stub of it.
    ['@types/express', '@types/express-serve-static-core', 'express'],
    ['Express', 'Application', 'Router', 'IRouter'],
  ),
  verbs: COMMON_VERBS,
  pathMethod: 'route',
  // One method both mounts and installs: `use(path, router)` is a mount and
  // `use(handler)` is middleware, and which it is depends on whether the last
  // argument is an application. Nothing but the type can say.
  mount: { method: 'use', appAt: -1, pathAt: 0 },
  middleware: { install: 'use', scoped: true },
};

/**
 * Fastify.
 *
 * Mounting is a plugin rather than a value: `app.register(routes, { prefix })`
 * hands a function an instance already scoped to the prefix, so the application
 * the routes are declared on is that function's first parameter. That is why
 * `asPlugin` exists, and it is the only thing in the description Express did
 * not ask for that a second framework needed.
 *
 * `@fastify/autoload` registers a whole directory, and the prefix is then the
 * directory's name rather than anything written in the call. That is a
 * file-system router — the same fact Next.js and Remix are, and the same
 * ticket — so it is not read, and the routes under it are reported as declared
 * on an application whose base cannot be told from here.
 */
export const FASTIFY: RouteDialect = {
  name: 'fastify-routes',
  packages: ['fastify'],
  appTypes: [{ package: 'fastify', typeName: 'FastifyInstance' }],
  verbs: COMMON_VERBS,
  mount: { method: 'register', appAt: 0, prefixKey: { at: 1, key: 'prefix' }, asPlugin: true },
  middleware: {
    install: 'addHook',
    named: true,
    optionKeys: ['preHandler', 'onRequest', 'preValidation', 'preParsing'],
  },
  routeObject: { method: 'route', verbKey: 'method', pathKey: 'url', handlerKey: 'handler' },
};

/**
 * Koa, which declares no route on the application at all.
 *
 * `koa-router` is where the verbs live, and the Koa application is listed only
 * because it is where the middleware in front of a whole router is installed:
 * `app.use(jwt(…))` and then `app.use(protectedRouter.routes())` is how a Koa
 * repository says every route on that router is behind a token. Reading the
 * router alone would read the routes and miss the only guard in the repository.
 *
 * The prefix is usually the constructor's, `new Router({ prefix: '/users' })`,
 * which is why a prefix can be an option here and is an argument everywhere
 * else.
 */
export const KOA: RouteDialect = {
  name: 'koa-routes',
  packages: ['koa-router', '@koa/router', 'koa'],
  appTypes: [
    ...appTypes(['koa', '@types/koa'], ['Application']),
    ...appTypes(['koa-router', '@types/koa-router', '@koa/router', '@types/koa__router'], ['Router']),
  ],
  // `del` is koa-router's alias for `delete`, which is a reserved word.
  verbs: { ...COMMON_VERBS, del: 'DELETE' },
  prefixMethod: 'prefix',
  prefixMutates: true,
  prefixOption: 'prefix',
  mount: { method: 'use', appAt: -1, pathAt: 0, through: ['routes', 'allowedMethods'] },
  middleware: { install: 'use', scoped: true },
};

/**
 * Hono, which was read first and is now a row like the others.
 *
 * Two things are its own. `on` takes the verb as an argument, which no other
 * one here does; and `basePath` returns a *new* application carrying a prefix,
 * where Koa's `prefix` changes the router it is called on.
 *
 * Its `middleware` row was left empty for a while, which meant `app.use('*',
 * logger)` was read as neither a route nor a guard. That was never a fact about
 * Hono: it was the Hono fixture's snapshot standing as proof that turning one
 * reader into four changed nothing about what the first one read, and filling
 * the field moves it. The proof has served its purpose and the field is filled,
 * because the audit now asks each adapter whether it read installs and an
 * adapter that could read them but does not makes that answer a lie.
 *
 * `use` is not the mount here — Hono mounts with `route` — so unlike Express
 * and Koa this install has nothing to be told apart from.
 */
export const HONO: RouteDialect = {
  name: 'hono-routes',
  packages: ['hono'],
  // `c.get('orders')` reads a value off the request context and is written on a
  // receiver from this same package. Only the application declares routes, so
  // the type name is checked as well as where it came from; without that, every
  // context lookup in a worker becomes a route.
  appTypes: [{ package: 'hono', typeName: 'Hono' }],
  verbs: COMMON_VERBS,
  verbArgument: 'on',
  prefixMethod: 'basePath',
  mount: { method: 'route', appAt: 1, pathAt: 0 },
  middleware: { install: 'use', scoped: true },
};

/** Every framework that registers a route by calling the application. */
export const ROUTE_DIALECTS: readonly RouteDialect[] = [EXPRESS, FASTIFY, KOA, HONO];
