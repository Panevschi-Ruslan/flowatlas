import type { EntryAdapter, EntryHandler, EntryNode, ExtractContext } from '@flowatlas/core';
import {
  evaluateExpression,
  hasAnyDependency,
  isHttpMethod,
  makeEntryId,
  makeHttpEntryKey,
  normalizePath,
  originOfValue,
  resolveTypeOrigin,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  enclosingClass,
  fileOfNode,
  handlerOfFunction,
  handlerReturned,
  joinPath,
  repoFunctionOf,
  repoSources,
} from './shared.js';

const ADAPTER = 'hono-routes';

/** The package whose type on the receiver is what makes a call a route. */
const HONO = 'hono';

/**
 * The type that declares routes, as opposed to every other type in the package.
 *
 * `c.get('nest')` reads a value off the request context and is written on a
 * receiver from the same package as `app.get('/health', …)`. Only the
 * application declares routes, so the type name is checked as well as where it
 * came from; without that, every context lookup in a worker becomes a route.
 */
const APP_TYPE = 'Hono';

/** Method name to the verb it answers. `all` answers every one, as `@All` does. */
const VERBS: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  all: 'ALL',
};

/** `app.on('GET', '/x', h)` — the verb is an argument rather than the method. */
const BY_ARGUMENT = 'on';

/** Methods that move a whole application, rather than declare one route. */
const BASE_PATH = 'basePath';
const MOUNT = 'route';

const DYNAMIC_PATH_HINT =
  'Give the route a string literal or a const string; a computed path cannot be matched against callers.';

/** Whether an expression is an application of the framework, by its type. */
const isApp = (expr: TsNode): boolean => {
  const origin = resolveTypeOrigin(expr);
  return origin?.package === HONO && origin.typeName === APP_TYPE;
};

/** The string an expression spells out, or undefined when it spells out none. */
const stringArg = (argument: TsNode | undefined): string | undefined => {
  if (argument === undefined) return undefined;
  const value = evaluateExpression(argument);
  return value.resolved && typeof value.value === 'string' ? value.value : undefined;
};

/** The verbs `on` was given, as written: one, or a list of them. */
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

const unwrap = (expr: TsNode): TsNode =>
  Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr)
    ? unwrap(expr.getExpression())
    : expr;

/** A call of the shape `<app>.<method>(…)`, which is all this reads. */
interface AppCall {
  call: TsNode;
  receiver: TsNode;
  method: string;
  args: TsNode[];
}

const appCallsIn = function* (sourceFile: SourceFile): Generator<AppCall> {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const receiver = callee.getExpression();
    if (!isApp(receiver)) continue;
    yield { call, receiver, method: callee.getName(), args: call.getArguments() };
  }
};

/**
 * Where one application was hung inside another.
 *
 * `parent.route('/admin', admin)` says every route declared on `admin` is served
 * a level down, and `admin` is usually declared in another file entirely. The
 * mount is recorded against the declaration so that a route found later, on the
 * other side of an import, can be placed where it is really served.
 */
interface Mount {
  parent: TsNode;
  /** Absent when the mount path could not be read. */
  at?: string;
}

/**
 * Every place an application's base is shifted, collected before any route is.
 *
 * A mount may be written after the routes it moves, or in a different file, so
 * there is no order in which one pass would do. `shifts` says whether the
 * repository moves any application at all: where nothing does, every application
 * in it serves what it declares, which is what makes an application arriving as
 * a parameter readable rather than a guess.
 */
class Bases {
  readonly #mounts = new Map<TsNode, Mount[]>();
  #shifts = false;

  get shifts(): boolean {
    return this.#shifts;
  }

  collect(site: AppCall): void {
    if (site.method === BASE_PATH) {
      this.#shifts = true;
      return;
    }
    if (site.method !== MOUNT) return;
    this.#shifts = true;
    const mounted = site.args[1];
    if (mounted === undefined) return;
    const origin = originOfValue(mounted);
    if (origin.kind !== 'local') return;
    const at = stringArg(site.args[0]);
    const found = this.#mounts.get(origin.declaration) ?? [];
    found.push({ parent: site.receiver, ...(at === undefined ? {} : { at }) });
    this.#mounts.set(origin.declaration, found);
  }

  /**
   * Every path an application is reached at, or undefined when it cannot be told.
   *
   * Usually one, and usually empty: an application that is nobody's sub-application
   * and shifts nothing serves what it declares. More than one is an application
   * mounted twice, which really does serve every route of it at both places.
   */
  prefixesOf(expr: TsNode, seen: Set<TsNode> = new Set()): string[] | undefined {
    const node = unwrap(expr);
    if (Node.isNewExpression(node)) return isApp(node) ? [''] : undefined;

    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return undefined;
      const inner = this.prefixesOf(callee.getExpression(), seen);
      if (inner === undefined) return undefined;
      // `route` returns the application it was called on, so a route written
      // after one is on the parent and not on what was mounted.
      if (callee.getName() === MOUNT) return inner;
      if (callee.getName() !== BASE_PATH) return undefined;
      const at = stringArg(node.getArguments()[0]);
      return at === undefined ? undefined : inner.map((prefix) => joinPath(prefix, at));
    }

    const origin = originOfValue(node);
    if (origin.kind !== 'local') return undefined;
    return this.#ofDeclaration(origin.declaration, seen);
  }

  #ofDeclaration(declaration: TsNode, seen: Set<TsNode>): string[] | undefined {
    // An application that reaches itself has no base that terminates, and a
    // depth limit here would only choose an arbitrary answer to that.
    if (seen.has(declaration)) return undefined;
    seen.add(declaration);

    const initializer = Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : undefined;
    // A parameter, or a binding whose value is not written here: the base is
    // whatever the caller had, which only the caller knows.
    const own = initializer === undefined ? undefined : this.prefixesOf(initializer, seen);
    const mounts = this.#mounts.get(declaration);
    if (mounts === undefined) return own;

    const out: string[] = [];
    for (const mount of mounts) {
      if (mount.at === undefined) return undefined;
      const above = this.prefixesOf(mount.parent, seen);
      if (above === undefined) return undefined;
      for (const outer of above) {
        for (const inner of own ?? ['']) out.push(joinPath(outer, mount.at, inner));
      }
    }
    return out;
  }
}

/** What answers one route, and how confidently that could be said. */
interface Answer {
  handler?: EntryHandler;
  /** `function` named outright, `call` returned by one written in place, else none. */
  via: 'function' | 'call' | 'inline';
}

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
const answerOf = (site: AppCall, argument: TsNode | undefined, ctx: ExtractContext): Answer => {
  const named = repoFunctionOf(argument);
  if (named !== undefined) return { handler: handlerOfFunction(named, ctx), via: 'function' };
  const inside = handlerReturned(argument, enclosingClass(site.call), ctx);
  return inside === undefined ? { via: 'inline' } : { handler: inside, via: 'call' };
};

/** One route, as declared. */
interface Route {
  verbs: string[];
  path: string;
  /** Middleware written between the path and the handler, as it is spelled. */
  middleware: string[];
  answer: Answer;
}

const routeOf = (site: AppCall, ctx: ExtractContext): Route | undefined => {
  const byArgument = site.method === BY_ARGUMENT;
  const verb = VERBS[site.method];
  if (verb === undefined && !byArgument) return undefined;
  // One argument is a path with nothing to answer it, which the framework
  // accepts and which declares no way in.
  if (site.args.length < (byArgument ? 3 : 2)) return undefined;

  const verbs = byArgument ? verbsArg(site.args[0]) : [verb as string];
  if (verbs === undefined) return undefined;
  const path = stringArg(site.args[byArgument ? 1 : 0]);
  if (path === undefined) return undefined;

  const handlerArg = site.args[site.args.length - 1];
  return {
    verbs,
    path,
    middleware: site.args
      .slice(byArgument ? 2 : 1, site.args.length - 1)
      .map((argument) => argument.getText().split('\n')[0]?.slice(0, 40) ?? ''),
    answer: answerOf(site, handlerArg, ctx),
  };
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
 */
export const honoRoutesAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, [HONO]),
  extractEntries: (ctx: ExtractContext) => {
    const sources = [...repoSources(ctx)];
    const bases = new Bases();
    for (const sourceFile of sources) {
      for (const site of appCallsIn(sourceFile)) bases.collect(site);
    }

    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const anonymous: Site[] = [];

    for (const sourceFile of sources) {
      for (const site of appCallsIn(sourceFile)) {
        const route = routeOf(site, ctx);
        if (route === undefined) {
          reportUnreadable(ctx, site);
          continue;
        }

        const file = fileOfNode(site.call, ctx);
        const line = site.call.getStartLineNumber();
        // Where nothing in the repository moves an application, every one of
        // them serves what it declares, so an application handed in as an
        // argument needs no caller to be found before its routes can be placed.
        const prefixes = bases.prefixesOf(site.receiver) ?? (bases.shifts ? undefined : ['']);
        if (prefixes === undefined) {
          ctx.builder.addUnresolved({
            file,
            line,
            reason: 'route-path-dynamic',
            message: `${site.receiver.getText().slice(0, 40)} is mounted somewhere this cannot read, so ${route.path} is not the path it is served at.`,
            hint: 'Mount the application at a literal path, or declare its routes on the application that is served.',
            symbol: `${route.verbs.join(',')} ${route.path}`,
            adapter: ADAPTER,
          });
          continue;
        }

        if (route.answer.via === 'inline') anonymous.push({ file, line });

        for (const prefix of prefixes) {
          const rawPath = joinPath(prefix, route.path);
          const path = normalizePath(rawPath);
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
                adapter: ADAPTER,
                registration: `${site.receiver.getText().slice(0, 40)}.${site.method}`,
                ...(route.middleware.length > 0 ? { middleware: route.middleware } : {}),
                // Said plainly, because a walk from this entry is only as narrow
                // as the answer to "which code does the handler run".
                handlerVia: route.answer.via,
              },
            });
          }
        }
      }
    }

    if (anonymous.length > 0) reportAnonymous(ctx, anonymous);
    return entries;
  },
};

/** Where one route was declared, kept so a folded row still points somewhere. */
interface Site {
  file: string;
  line: number;
}

/**
 * A route whose path or verb could not be read.
 *
 * Only for calls that really are route declarations: `use` installs middleware
 * and `notFound` installs a last resort, and neither is a way in that anything
 * could ask for by name.
 */
const reportUnreadable = (ctx: ExtractContext, site: AppCall): void => {
  const byArgument = site.method === BY_ARGUMENT;
  if (VERBS[site.method] === undefined && !byArgument) return;
  if (site.args.length < (byArgument ? 3 : 2)) return;
  const written = site.args[byArgument ? 1 : 0];

  ctx.builder.addUnresolved({
    file: fileOfNode(site.call, ctx),
    line: site.call.getStartLineNumber(),
    reason: 'route-path-dynamic',
    hint: DYNAMIC_PATH_HINT,
    symbol: `${site.receiver.getText().slice(0, 40)}.${site.method}(${written?.getText().slice(0, 40) ?? ''})`,
    adapter: ADAPTER,
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
const reportAnonymous = (ctx: ExtractContext, sites: readonly Site[]): void => {
  const first = [...sites].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))[0] as Site;
  const count = sites.length;
  ctx.builder.addUnresolved({
    file: first.file,
    line: first.line,
    reason: 'route-handler-anonymous',
    level: 'info',
    sites: count,
    message: `${count} route${count === 1 ? '' : 's'} answer with a function written in the declaration, so nothing can be pointed at as the code behind them.`,
    hint: 'Give the handler a name and register that, or have the one written in place return what a single named function answers with.',
    symbol: HONO,
    adapter: ADAPTER,
  });
};
