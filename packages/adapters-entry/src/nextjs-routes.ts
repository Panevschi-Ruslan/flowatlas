import {
  hasAnyDependency,
  hasDependency,
  makeEntryId,
  makeHttpEntryKey,
  namedFunction,
  normalizeFilePath,
  originOfValue,
  reachHere,
  reachMeta,
  reachOf,
  type ApplicationMap,
  type EntryAdapter,
  type EntryHandler,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
  type NamedFunction,
  type Reach,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ActionBuilder } from './action-builders.js';
import { ACTION_BUILDERS } from './action-builders.js';
import {
  fsAddressSpace,
  fsApplicationMap,
  pathPatternTest,
  readVerbFile,
  reportUnreadHandler,
} from './fs-routes.js';
import { APP_ROUTER, PAGES_API } from './nextjs-paths.js';
import {
  handlerOfFunction,
  inlineHandlerOf,
  repoFunctionOf,
  repoSources,
  unwrapValue,
} from './shared.js';

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
      const test = pathPatternTest(pattern.getLiteralValue());
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

/** One way in, as every reader in this file describes it. */
interface HttpEntryOptions {
  method: string;
  path: string;
  /**
   * Where the way in was found, and where its verb was written.
   *
   * One value rather than a `file` and a `line`, because the defect this replaced
   * was a caller passing halves of two different answers: the file it was reading
   * and the line the compiler gave for a verb another module declares (R99).
   */
  at: Reach;
  handler?: NamedFunction;
  via: string;
  /** False when a handler was named and there is nothing behind the name. */
  bodyRead?: boolean;
  /**
   * The application that serves it, where the service holds more than one.
   *
   * An address is an address within one application, and which one is part of
   * the identity rather than of the path (R119, R125).
   */
  application?: string;
}

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
/**
 * Which applications this repository holds, read from where its route files are.
 *
 * One function and two callers, because two readings of the same directories
 * would be two opinions about what an application is: the ids minted below, and
 * whoever asks which application a file that declares no route belongs to —
 * a component making a request (R132).
 */
const applicationsOf = (ctx: ExtractContext): ApplicationMap =>
  fsApplicationMap(
    [...repoSources(ctx)].map((source) => normalizeFilePath(source.getFilePath(), ctx.repoDir)),
    [APP_ROUTER, PAGES_API],
  );

export const nextjsRoutesAdapter: EntryAdapter = {
  name: 'nextjs-routes',
  detect: (pkg) => hasDependency(pkg, PACKAGE),
  applications: (ctx) => applicationsOf(ctx),

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

    /**
     * What stands in front of a route, described for the extractor to draw.
     *
     * The file is what there is to point at — one module guards the whole
     * repository and the framework gives it no name of its own — and it is
     * drawn as the same `guarded_by` edge a guard class gets, so that a route
     * this file covers does not read as an unguarded route to everything that
     * walks the graph (R109).
     */
    const gateOf = (path: string): readonly EntryWrapping[] => {
      if (middleware === undefined) return [];
      if (middleware.covers !== undefined && !middleware.covers(path)) return [];
      return [
        {
          label: middleware.file,
          layer: 'middleware',
          scope: 'global',
          source: 'middleware file',
          file: middleware.file,
          line: 1,
          kind: 'file',
        },
      ];
    };

    const httpEntry = (options: HttpEntryOptions): void => {
      const key = makeHttpEntryKey(options.method, options.path);
      const id = makeEntryId(ctx.repo, 'http', key, options.application);
      if (seen.has(id)) return;
      seen.add(id);
      const gate = gateOf(options.path);
      entries.push({
        id,
        kind: 'http',
        label:
          options.application === undefined
            ? `${options.method} ${options.path}`
            : `${options.method} ${options.path} (${options.application})`,
        key,
        ...(options.handler === undefined
          ? {}
          : { handler: handlerOfFunction(options.handler, ctx) }),
        file: options.at.reached.file,
        line: options.at.reached.line,
        ...(gate.length > 0 ? { wrapping: gate } : {}),
        meta: {
          method: options.method,
          path: options.path,
          adapter: 'nextjs-routes',
          registration: options.via,
          // Only where there is more than one, which is where it says
          // something: it is what tells a tie between two applications from a
          // tie between two routes of one.
          ...(options.application === undefined ? {} : { application: options.application }),
          middlewareRead,
          // The route file is what the node points at, because the address is
          // read from where that file is and a node naming any other file would
          // be a way in nothing serves. Where the verb was written is the other
          // fact, and it is recorded rather than folded into the first one.
          ...reachMeta(options.at),
          handlerVia: options.handler === undefined ? 'unread' : 'function',
          // Two different facts, and the second is the one a summary must not
          // read off the first. `handlerVia` says whether a function was named;
          // this says whether there is code behind the name. A route counted as
          // covered because a name was found is how seventeen of seventeen came
          // to stand for two of nine (R94).
          ...(options.bodyRead === false ? { handlerBodyRead: false } : {}),
        },
      });
    };

    // Which applications this repository holds, and what each address is
    // qualified by. Read for the whole service before any of it is emitted,
    // because whether an id names an application depends on how many
    // applications there are — the one thing a single file cannot say (R125).
    const space = fsAddressSpace(applicationsOf(ctx));

    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const appAddress = space.addressOf(file, APP_ROUTER);
      const pagesAddress = space.addressOf(file, PAGES_API);

      if (appAddress !== null) {
        // The shared reading of a directory-addressed route file: the verbs it
        // exports, what is behind each of them, and the rows for the ones with
        // nothing behind them. Only what to do with each verb is this reader's
        // own — the gate in front of it, and the name on the entry (R91).
        readVerbFile(ctx, sourceFile, {
          file,
          path: appAddress.path,
          adapter: 'nextjs-routes',
          emit: (verb) => httpEntry({ ...verb, ...appAddress, via: 'app/route' }),
        });
        continue;
      }
      if (pagesAddress !== null) {
        // The older router answers every verb from one handler: the file is one
        // way in, and which method arrives is the handler's own business.
        const [declaration] = sourceFile.getExportedDeclarations().get('default') ?? [];
        const handler = declaration === undefined ? undefined : exportedFunction(declaration);
        const read = handler !== undefined;
        // The declaration may be in another file entirely — one line forwarding
        // another module's default is how a large repository keeps its addresses
        // in the application and its bodies in a package — so the position is
        // asked of the file being read rather than of what the compiler resolved.
        const at =
          declaration === undefined
            ? reachHere(file, 1)
            : reachOf(declaration, sourceFile, 'default', ctx.repoDir);
        httpEntry({
          method: 'ALL',
          ...pagesAddress,
          at,
          ...(handler === undefined ? {} : { handler }),
          via: 'pages/api',
          bodyRead: read,
        });
        // A file under the older router is a way in whether or not its default
        // export is a function this can follow, and until now the second case
        // was the first case with a quieter graph. Only one reading applies
        // here — a function written in place — so a handler that was found is a
        // handler that was read, and there is one case to report rather than two.
        if (!read) {
          reportUnreadHandler(ctx, {
            file: at.reached.file,
            line: at.reached.line,
            label: `ALL ${pagesAddress.path}`,
            path: pagesAddress.path,
            why: 'none',
            adapter: 'nextjs-routes',
          });
        }
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
   * where it was found and where it was written, the code behind it and how
   * confidently that could be named — so the node is built in one place and a
   * reader comparing a built action with a declared one is comparing the same
   * thing.
   */
  const record = (options: {
    name: string;
    at: Reach;
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
      file: options.at.reached.file,
      line: options.at.reached.line,
      meta: {
        action: options.name,
        // The module the client imports is the boundary, so that is the file the
        // node names; where the function itself was written is the second fact
        // and is kept as one (R99).
        ...reachMeta(options.at),
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
      const at = reachOf(declaration, sourceFile, name, ctx.repoDir);
      if (built === undefined) {
        unreadable.push({ file: at.reached.file, name, line: at.reached.line });
        continue;
      }
      const named = repoFunctionOf(built.action);
      record({
        name,
        at,
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

    record({
      name,
      at: reachOf(fn.declaration, sourceFile, name, ctx.repoDir),
      handler: handlerOfFunction(fn, ctx),
      via: 'function',
    });
  }
  return unreadable;
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
      const position = builder.methods.get(method);
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
