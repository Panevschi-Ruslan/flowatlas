import {
  hasAnyDependency,
  hasDependency,
  HTTP_METHODS,
  makeEntryId,
  makeHttpEntryKey,
  namedFunction,
  normalizeFilePath,
  type EntryAdapter,
  type EntryHandler,
  type EntryNode,
  type ExtractContext,
  type NamedFunction,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ActionBuilder } from './action-builders.js';
import { ACTION_BUILDERS } from './action-builders.js';
import { APP_ROUTER, PAGES_API, routePathOfFile } from './nextjs-paths.js';
import { handlerOfFunction, inlineHandlerOf, repoFunctionOf, repoSources } from './shared.js';

/** The dependency that gives the framework away. */
const PACKAGE = 'next';

/** The directive that turns a module, or one function, into a boundary. */
const USE_SERVER = 'use server';

/** Where the framework looks for the guard that runs in front of everything. */
const MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];

/**
 * The directive a file or a function opens with, when it opens with one.
 *
 * A directive is an ordinary expression statement as far as the parser is
 * concerned, which is why it has to be read rather than asked for: it is the
 * first statement, it is a string, and nothing else about it is special.
 */
const opensWith = (statements: readonly TsNode[], directive: string): boolean => {
  const [first] = statements;
  if (first === undefined || !Node.isExpressionStatement(first)) return false;
  const expression = first.getExpression();
  return (
    (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) &&
    expression.getLiteralValue() === directive
  );
};

/** The named function a declaration stands for, wherever it was exported from. */
const exportedFunction = (declaration: TsNode): NamedFunction | undefined =>
  namedFunction(declaration);

/**
 * How far a matcher pattern reaches, as a test on a path.
 *
 * `undefined` means the pattern could not be read, which is the common case and
 * deliberately not the same as "it does not cover this route". The framework
 * accepts a full regular expression here, and repositories use one — the
 * canonical example in its own documentation is a negative lookahead. Claiming
 * a route is guarded because an expression nobody read might have matched it
 * would be the worst thing this tool could say.
 */
const matcherTest = (pattern: string): ((path: string) => boolean) | undefined => {
  if (!pattern.startsWith('/')) return undefined;
  if (/[()|?!]/.test(pattern)) return undefined;
  const expression = pattern
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith(':')) return segment.endsWith('*') ? '.*' : '[^/]+';
      if (segment === '*') return '.*';
      return segment.replace(/[.+^${}[\]\\]/g, '\\$&');
    })
    .join('/');
  const compiled = new RegExp(`^${expression}$`);
  return (path) => compiled.test(path);
};

/** What `middleware.ts` guards, when the repository has one. */
interface Middleware {
  file: string;
  /** Paths it covers; when absent it covers everything the framework serves. */
  covers?: (path: string) => boolean;
  /** Patterns written that could not be turned into a test. */
  unread: readonly string[];
}

const readMiddleware = (ctx: ExtractContext): Middleware | undefined => {
  for (const sourceFile of repoSources(ctx)) {
    const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
    if (!MIDDLEWARE_FILES.includes(file)) continue;

    const unread: string[] = [];
    const tests: Array<(path: string) => boolean> = [];
    const config = sourceFile.getVariableDeclaration('config');
    const written = config?.getInitializer();
    const matcher =
      written !== undefined && Node.isObjectLiteralExpression(written)
        ? written.getProperty('matcher')
        : undefined;
    const value =
      matcher !== undefined && Node.isPropertyAssignment(matcher) ? matcher.getInitializer() : undefined;
    const patterns = value === undefined
      ? []
      : Node.isArrayLiteralExpression(value)
        ? value.getElements()
        : [value];

    for (const pattern of patterns) {
      if (!Node.isStringLiteral(pattern) && !Node.isNoSubstitutionTemplateLiteral(pattern)) {
        unread.push(pattern.getText());
        continue;
      }
      const test = matcherTest(pattern.getLiteralValue());
      if (test === undefined) unread.push(pattern.getLiteralValue());
      else tests.push(test);
    }

    // No matcher at all is the framework's own default: everything is behind it.
    const covers =
      patterns.length === 0 ? undefined : (path: string) => tests.some((test) => test(path));
    return { file, ...(covers === undefined ? {} : { covers }), unread };
  }
  return undefined;
};

/**
 * Entry points a Next.js repository declares by where its files are.
 *
 * Four different facts, and they are worth separating because they fail
 * differently. A route handler is a path and a verb, joinable to a request made
 * anywhere. An older `pages/api` file is the same fact with the file name as
 * the last segment. `middleware.ts` is the guard equivalent, and what it covers
 * is usually a regular expression nobody can read, so it is recorded as what it
 * is rather than as coverage nobody checked. And a server action is a boundary
 * with no address at all: the client reaches it by importing it, the bundler
 * turns the import into a request, and there is no string anywhere to join on —
 * so the edge is the import, and this only has to say that the boundary exists.
 */
export const nextjsRoutesAdapter: EntryAdapter = {
  name: 'nextjs-routes',
  detect: (pkg) => hasDependency(pkg, PACKAGE),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const unreadable: UnreadableAction[] = [];
    const middleware = readMiddleware(ctx);
    // Only the libraries this repository actually depends on. Without that a
    // method called `action` or `handler` on anything at all would be read as
    // a boundary, and a description that matches by name alone would be a
    // guess wearing a row's clothes.
    const builders = ACTION_BUILDERS.filter((builder) =>
      hasAnyDependency(ctx.pkg, builder.packages),
    );

    /**
     * Whether what stands in front of a route was read, rather than guessed.
     *
     * A repository with no `middleware.ts` has nothing installed for a whole
     * prefix, and that is read rather than assumed: the file is looked for. A
     * matcher written as a regular expression is the one case where it was
     * not — the file is there, it guards something, and which routes is
     * exactly what could not be told — so every route in such a repository
     * says its guard may be one nobody here saw.
     */
    const middlewareRead = middleware === undefined || middleware.unread.length === 0;

    /** What a route says about the guard in front of it. */
    const gateOf = (path: string): Record<string, unknown> => {
      if (middleware === undefined) return { middlewareRead };
      if (middleware.covers === undefined) return { middlewareRead, middleware: [middleware.file] };
      return middleware.covers(path)
        ? { middlewareRead, middleware: [middleware.file] }
        : { middlewareRead };
    };

    const httpEntry = (options: {
      method: string;
      path: string;
      file: string;
      line: number;
      handler?: NamedFunction;
      via: string;
    }): void => {
      const key = makeHttpEntryKey(options.method, options.path);
      const id = makeEntryId(ctx.repo, 'http', key);
      if (seen.has(id)) return;
      seen.add(id);
      entries.push({
        id,
        kind: 'http',
        label: `${options.method} ${options.path}`,
        key,
        ...(options.handler === undefined
          ? {}
          : { handler: handlerOfFunction(options.handler, ctx) }),
        file: options.file,
        line: options.line,
        meta: {
          method: options.method,
          path: options.path,
          adapter: 'nextjs-routes',
          registration: options.via,
          ...gateOf(options.path),
          handlerVia: options.handler === undefined ? 'unread' : 'function',
        },
      });
    };

    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const appPath = routePathOfFile(file, APP_ROUTER);
      const pagesPath = routePathOfFile(file, PAGES_API);

      if (appPath !== null) {
        readAppRoute(ctx, sourceFile, file, appPath, httpEntry);
        continue;
      }
      if (pagesPath !== null) {
        // The older router answers every verb from one handler: the file is one
        // way in, and which method arrives is the handler's own business.
        const [declaration] = sourceFile.getExportedDeclarations().get('default') ?? [];
        const handler = declaration === undefined ? undefined : exportedFunction(declaration);
        httpEntry({
          method: 'ALL',
          path: pagesPath,
          file,
          line: handler?.line ?? 1,
          ...(handler === undefined ? {} : { handler }),
          via: 'pages/api',
        });
        continue;
      }

      unreadable.push(...readServerActions(ctx, sourceFile, file, entries, seen, builders));
    }

    if (unreadable.length > 0) reportUnreadableActions(ctx, unreadable);

    if (middleware !== undefined && middleware.unread.length > 0) {
      ctx.builder.addUnresolved({
        file: middleware.file,
        line: 1,
        reason: 'middleware-matcher-unread',
        message: `${middleware.unread.length} matcher pattern${middleware.unread.length === 1 ? '' : 's'} in ${middleware.file} ${middleware.unread.length === 1 ? 'is' : 'are'} a regular expression, so which routes it guards was not read.`,
        hint: 'Routes this covers are reported as unguarded. Write the matcher as a path pattern, or name the routes under doctor.publicRoutes.',
        symbol: middleware.unread.join(' '),
        adapter: 'nextjs-routes',
      });
    }

    return entries;
  },
};

/** The verbs a route file exports, each of them one way in. */
const readAppRoute = (
  ctx: ExtractContext,
  sourceFile: SourceFile,
  file: string,
  path: string,
  emit: (options: {
    method: string;
    path: string;
    file: string;
    line: number;
    handler?: NamedFunction;
    via: string;
  }) => void,
): void => {
  // Asked of the compiler rather than of the statements, so that the three
  // shapes a real repository writes all answer: a function declared here, a
  // name re-exported under a verb's name, and a whole module re-exported from
  // somewhere else. In the repository this was measured against, twenty-six of
  // the five hundred and twenty route files are one of the last two.
  const exported = sourceFile.getExportedDeclarations();
  let found = 0;
  for (const method of HTTP_METHODS) {
    const [declaration] = exported.get(method) ?? [];
    if (declaration === undefined) continue;
    found += 1;
    const handler = exportedFunction(declaration);
    emit({
      method,
      path,
      file,
      line: declaration.getStartLineNumber(),
      ...(handler === undefined ? {} : { handler }),
      via: 'app/route',
    });
  }

  if (found > 0) return;
  ctx.builder.addUnresolved({
    file,
    line: 1,
    reason: 'route-verb-unread',
    message: `${file} is served at ${path} but exports no verb this could read.`,
    hint: 'Export GET, POST and the rest by name; a verb assembled at run time cannot be joined to anything that asks for it.',
    symbol: path,
    adapter: 'nextjs-routes',
  });
};

/**
 * The functions a module hands to the client as a boundary.
 *
 * Three spellings and the same fact. The whole module is marked, or one
 * function in it is, or the module is marked and the export is what a builder
 * handed back — which is the dominant spelling in this ecosystem and was the
 * one that read as nothing at all until a row described where the action sits
 * in the call. What makes this worth a node of its own is that both ends are in
 * this repository and the call between them crosses a process: the component
 * imports the function and calls it, and what happens at run time is a request
 * to the server with no address written anywhere. The import is the only
 * evidence there is, and it is enough.
 */
const readServerActions = (
  ctx: ExtractContext,
  sourceFile: SourceFile,
  file: string,
  entries: EntryNode[],
  seen: Set<string>,
  builders: readonly ActionBuilder[],
): UnreadableAction[] => {
  const wholeModule = opensWith(sourceFile.getStatements(), USE_SERVER);
  const unreadable: UnreadableAction[] = [];

  /**
   * One boundary, however it was written.
   *
   * Both spellings arrive here with the same four facts — the exported name,
   * the line it is declared on, the code behind it and how confidently that
   * could be named — so the node is built in one place and a reader comparing
   * a built action with a declared one is comparing the same thing.
   */
  const record = (options: {
    name: string;
    line: number;
    handler: EntryHandler | undefined;
    via: 'function' | 'inline';
    builder?: string;
  }): void => {
    const key = `action:${file}#${options.name}`;
    const id = makeEntryId(ctx.repo, 'rpc', key);
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({
      id,
      kind: 'rpc',
      label: `action ${options.name}`,
      key,
      ...(options.handler === undefined ? {} : { handler: options.handler }),
      file,
      line: options.line,
      meta: {
        action: options.name,
        adapter: 'nextjs-routes',
        registration: wholeModule ? "module 'use server'" : "function 'use server'",
        ...(options.builder === undefined ? {} : { builder: options.builder }),
        // There is no address, so nothing joins this to a caller by matching
        // one. Whoever imports it is the caller, and saying so here is what
        // lets a pass that has the import graph draw that edge without knowing
        // anything about this framework.
        viaImport: true,
        handlerVia: options.via,
      },
    });
  };

  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    const [declaration] = declarations;
    if (declaration === undefined) continue;
    const fn = exportedFunction(declaration);
    if (fn === undefined) {
      // A value the module exports that is not a function written in place.
      // In a module marked whole every one of these is a boundary the client
      // may cross, and the commonest way to write one is a builder that wraps
      // validation round the body. A builder some row describes is read as the
      // action it is; one nobody describes is a hole, and a hole nobody is
      // told about reads as a repository with no actions in it (R07).
      if (!wholeModule || !Node.isVariableDeclaration(declaration)) continue;
      const built = builtAction(declaration, builders);
      if (built === undefined) {
        unreadable.push({ file, name, line: declaration.getStartLineNumber() });
        continue;
      }
      const named = repoFunctionOf(built.action);
      record({
        name,
        line: declaration.getStartLineNumber(),
        handler:
          named === undefined
            ? inlineHandlerOf(built.action, `action ${name}`, ctx)
            : handlerOfFunction(named, ctx),
        via: named === undefined ? 'inline' : 'function',
        builder: built.builder.name,
      });
      continue;
    }
    // A module marked whole makes every exported function a boundary. A module
    // that is not may still have one function that marks itself.
    const marked = wholeModule || (Node.isBlock(fn.body) && opensWith(fn.body.getStatements(), USE_SERVER));
    if (!marked) continue;

    record({ name, line: fn.line, handler: handlerOfFunction(fn, ctx), via: 'function' });
  }
  return unreadable;
};

/** `(x)`, `x as T` and `await x` all stand for whatever is inside them. */
const unwrapValue = (expr: TsNode): TsNode => {
  if (
    Node.isParenthesizedExpression(expr) ||
    Node.isAsExpression(expr) ||
    Node.isAwaitExpression(expr)
  ) {
    return unwrapValue(expr.getExpression());
  }
  return expr;
};

/** Whether an expression is a function, written here or named elsewhere. */
const isFunctionValue = (node: TsNode): boolean =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  repoFunctionOf(node) !== undefined;

/**
 * The function a described builder was handed, when the value is built by one.
 *
 * The chain is walked from the outside in, because the call that receives the
 * action is the last one written and so the first one met: `client.schema(…)
 * .action(fn)` is an `action` call whose receiver is a `schema` call. A step
 * the description says nothing about is walked through rather than refused,
 * since a library is free to put `.metadata(…)` after the action — what
 * decides is whether any step is one a row names.
 *
 * The argument has to be a function. A method sharing a described name that is
 * handed a value rather than a function is not this library's action, and
 * reading it as one would put a boundary in the graph that does not exist.
 */
const builtAction = (
  declaration: TsNode,
  builders: readonly ActionBuilder[],
): { action: TsNode; builder: ActionBuilder } | undefined => {
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  let at = declaration.getInitializer();
  for (let depth = 0; at !== undefined && depth < 16; depth += 1) {
    const node = unwrapValue(at);
    if (!Node.isCallExpression(node)) return undefined;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.getName();
    for (const builder of builders) {
      const position = builder.methods[method];
      if (position === undefined) continue;
      const argument = node.getArguments()[position];
      if (argument === undefined) continue;
      const action = unwrapValue(argument);
      if (isFunctionValue(action)) return { action, builder };
    }
    at = callee.getExpression();
  }
  return undefined;
};

/** One exported value of a boundary module that is not a function to point at. */
interface UnreadableAction {
  file: string;
  name: string;
  line: number;
}

/**
 * Boundaries a module declares that nothing here can name the code behind.
 *
 * Counted rather than listed, because in a repository that builds its actions
 * with a helper this is every action it has, and a row apiece would be the tool
 * describing its own limits once per action (R07). One row names the first and
 * says how many there are, which is enough to go and look.
 */
const reportUnreadableActions = (ctx: ExtractContext, found: readonly UnreadableAction[]): void => {
  const first = [...found].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))[0] as UnreadableAction;
  ctx.builder.addUnresolved({
    file: first.file,
    line: first.line,
    reason: 'server-action-unread',
    sites: found.length,
    message: `${found.length} exported value${found.length === 1 ? '' : 's'} of a module marked 'use server' ${found.length === 1 ? 'is' : 'are'} built by a call no description names, so the boundary was not recorded.`,
    hint: 'Describe the builder in action-builders.ts by naming its package, the method that receives the action and which argument it is; or declare the action as `export async function name(...)`.',
    symbol: `${first.file}#${first.name}`,
    adapter: 'nextjs-routes',
  });
};
