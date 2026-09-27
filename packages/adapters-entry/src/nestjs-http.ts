import type { EntryAdapter, EntryNode, ExtractContext } from '@flowatlas/core';
import {
  applicationsIn,
  applicationsServing,
  decoratorArgs,
  decoratorName,
  evaluateExpression,
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  makeSymbolId,
  normalizePath,
  stringListArg,
  UNREAD_SPAN,
} from '@flowatlas/core';
import { Node, type Decorator, type MethodDeclaration, type Node as TsNode } from 'ts-morph';
import {
  decoratorNames,
  decoratorsFrom,
  fileOfNode,
  handlerOf,
  joinPath,
  repoClasses,
  type ForeignDecorator,
} from './shared.js';

/**
 * The package the decorators read here come from, matched as a package.
 *
 * Not as a module specifier: `@nestjs/common/decorators` is the same package and
 * the same `@Controller`, and matching the string exactly meant a controller
 * written that way reached the `continue` below before any row was written (R84).
 */
const NEST_PACKAGES = ['@nestjs/common'] as const;

/** Decorators of one node from Nest's own package, and the ones only named like them. */
const nestDecorators = (node: { getDecorators(): Decorator[] }, names: readonly string[]) =>
  decoratorsFrom(node, names, NEST_PACKAGES);

const firstNestDecorator = (
  node: { getDecorators(): Decorator[] },
  name: string,
): Decorator | undefined => nestDecorators(node, [name]).matched[0];

/**
 * A decorator spelled like one of Nest's and imported from somewhere else.
 *
 * Either Nest's after all, re-exported through a barrel the checker could not
 * follow, or a local decorator sharing the name. Nothing here can tell which,
 * and both readings matter to whoever is looking at the graph: the first means
 * routes are missing, the second means nothing is. So the class is named, the
 * module it imported from is quoted, and the reader decides — which is the whole
 * of the contract R84 is about, since what happened before was that the class
 * was passed over in silence.
 *
 * Informational, because a repository with its own `@Controller` is doing
 * nothing wrong and this is a limit of static reading rather than a mistake
 * somebody made.
 *
 * The reason is borrowed rather than invented, and it is worth saying why. Every
 * reason must be registered in `doctor`'s catalogue or I13 fails, and that
 * catalogue is in a package this ticket may not touch, so a new reason was not
 * available. `entry-http-types-unmatched` is the nearest true one — a reader that
 * recognised the framework and could not match where a declaration came from —
 * and a row carrying its own `hint`, as this one does, uses that sentence rather
 * than the catalogue's. What the borrowed reason costs is the heading this row is
 * grouped under, and the right fix is a reason of its own the day the catalogue
 * can be edited.
 */
const reportForeign = (
  ctx: ExtractContext,
  foreign: readonly ForeignDecorator[],
  where: { file: string; line: number; symbol: string },
): void => {
  for (const { decorator, module } of foreign) {
    ctx.builder.addUnresolved({
      file: where.file,
      line: where.line,
      reason: 'entry-http-types-unmatched',
      level: 'info',
      message: `${where.symbol} is decorated with @${decoratorName(decorator)} imported from '${module}', which this could not place as ${NEST_PACKAGES[0]}, so no route was read from it.`,
      hint: `Import the decorator from ${NEST_PACKAGES[0]} or a subpath of it, rather than through a module that re-exports it.`,
      symbol: where.symbol,
      adapter: 'nestjs-http',
    });
  }
};

/**
 * Decorator name to HTTP method. `All` stands for every method at once.
 *
 * A `Map`, because it is asked about both spellings of a decorator and the
 * local one is whatever the import aliased it to: an object literal answers an
 * alias of `toString` with the language's own function (R130).
 */
const ROUTE_DECORATORS: ReadonlyMap<string, string> = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Options', 'OPTIONS'],
  ['Head', 'HEAD'],
  ['All', 'ALL'],
]);

const FRAMEWORK_DECORATORS = new Set([
  ...ROUTE_DECORATORS.keys(),
  'Controller',
  'UseGuards',
  'UseInterceptors',
  'UsePipes',
  'UseFilters',
  'Version',
  'HttpCode',
  'Header',
  'Redirect',
  'Render',
  'Injectable',
]);

/**
 * The versions one route is served at.
 *
 * A list because `@Version(['1', '2'])` registers the same handler twice, and an
 * empty list because the framework has a word for a route that carries no version
 * at all. `undefined` is neither of those: it means this level said nothing and
 * the next one out should be asked.
 */
type Versions = readonly string[];

/**
 * What the application was told about versions, as the entry context carries it.
 *
 * Read out of plain metadata rather than imported, because the reader that puts
 * it there is the one for a single framework and this adapter is not allowed to
 * depend on it. So the shape is checked here rather than assumed.
 */
interface Versioning {
  type: string;
  prefix: string;
  defaultVersion?: string;
}

const versioningIn = (meta: Record<string, unknown> | undefined): Versioning | undefined => {
  const value = meta?.['versioning'];
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, prefix, defaultVersion } = value as Record<string, unknown>;
  if (typeof type !== 'string' || typeof prefix !== 'string') return undefined;
  return {
    type,
    prefix,
    ...(typeof defaultVersion === 'string' ? { defaultVersion } : {}),
  };
};

/**
 * The part in front of every address, where the reading of the application
 * found it is read from settings (R144).
 *
 * Carried onto each route whose address opens with the hole it stands for, as
 * the facts and nothing more: whether a request may be joined across it is the
 * linker's decision, made in one place there.
 */
const mountIn = (meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  const value = meta?.['mount'];
  if (typeof value !== 'object' || value === null) return undefined;
  const { settings, setIn, envFiles, at } = value as Record<string, unknown>;
  if (!Array.isArray(settings) || !Array.isArray(setIn) || typeof envFiles !== 'number') return undefined;
  return { settings, setIn, envFiles, ...(typeof at === 'string' ? { at } : {}) };
};

/**
 * Reads a version written as an option or as an argument.
 *
 * `VERSION_NEUTRAL` is matched by the name in the source rather than by its
 * value, because it is a symbol exported by an installed package: there is
 * nothing to evaluate on a fresh clone, and a route that names it is not a route
 * whose version could not be read — it is a route that deliberately has none.
 */
const readVersions = (node: TsNode | undefined): Versions | undefined => {
  if (node === undefined) return undefined;
  if (/\bVERSION_NEUTRAL\b/.test(node.getText())) return [];
  const value = evaluateExpression(node);
  if (!value.resolved) return undefined;
  if (typeof value.value === 'string') return [value.value];
  return Array.isArray(value.value) && value.value.every((item) => typeof item === 'string')
    ? (value.value as string[])
    : undefined;
};

/** The paths a `path` option names, or nothing when it names something unreadable. */
const readPaths = (node: TsNode | undefined): string[] | undefined => {
  if (node === undefined) return [''];
  const value = evaluateExpression(node);
  if (!value.resolved) return undefined;
  if (typeof value.value === 'string') return [value.value];
  if (Array.isArray(value.value) && value.value.every((item) => typeof item === 'string')) {
    return value.value.length > 0 ? (value.value as string[]) : [''];
  }
  return undefined;
};

/** The initialiser of one property of an object written out in place. */
const propertyIn = (node: TsNode, name: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(node)) return undefined;
  const property = node.getProperty(name);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

interface ControllerPrefix {
  paths: string[];
  versions?: Versions;
  dynamic: boolean;
}

/** `@Controller('x')`, `@Controller(['x','y'])` and `@Controller({ path, version })`. */
const readControllerPrefix = (decorator: Decorator): ControllerPrefix => {
  const [node] = decorator.getArguments();
  if (node === undefined) return { paths: [''], dynamic: false };

  // An options object is read one property at a time. Evaluating it whole lets
  // one unreadable property poison the readable ones, and
  // `@Controller({ path: '.well-known/x', version: VERSION_NEUTRAL })` — a real
  // controller in a repository this tool measures — was therefore dropped
  // entirely, with a row claiming its path was computed (R89).
  if (Node.isObjectLiteralExpression(node)) {
    const paths = readPaths(propertyIn(node, 'path'));
    if (paths === undefined) return { paths: [''], dynamic: true };
    const versions = readVersions(propertyIn(node, 'version'));
    return { paths, ...(versions === undefined ? {} : { versions }), dynamic: false };
  }

  const [first] = decoratorArgs(decorator);
  if (first === undefined) return { paths: [''], dynamic: false };
  if (!first.resolved) return { paths: [''], dynamic: true };
  const asList = stringListArg(first);
  return asList === undefined ? { paths: [''], dynamic: true } : { paths: asList, dynamic: false };
};

const versionsOf = (node: { getDecorators(): Decorator[] }): Versions | undefined => {
  const decorator = firstNestDecorator(node, 'Version');
  if (decorator === undefined) return undefined;
  return readVersions(decorator.getArguments()[0]);
};

/**
 * One entry per version the route is served at, with the segment its address
 * carries.
 *
 * Only URI versioning puts the version in the address; the header and media-type
 * kinds serve one address and choose a handler by what the request carried, so
 * there the version is worth recording and worth nothing to a path. Getting this
 * wrong in the other direction is not a lost detail: two controllers for one
 * resource at two versions land on one id, and the tool then reports a route
 * claimed by two handlers, which on novu was fourteen warnings and all of them
 * false (R89).
 */
const servedAt = (
  versions: Versions,
  versioning: Versioning | undefined,
): ReadonlyArray<{ version?: string; segment?: string }> =>
  versions.length === 0
    ? [{}]
    : versions.map((version) => ({
        version,
        ...(versioning?.type === 'uri' ? { segment: `${versioning.prefix}${version}` } : {}),
      }));

/**
 * HTTP routes.
 *
 * The path recorded is the one the framework prints at start-up: the global
 * prefix, then the version where versioning puts one in the address, then the
 * controller and the route. Counting entries against that log is then a
 * meaningful check, which is the whole reason the path is assembled this way.
 * The prefix is also kept on its own, because a client calling the service may
 * not include it.
 *
 * Where a part of the address could not be read, the part that could is kept and
 * the rest is the marker that matches nothing, so a caller is never joined to an
 * address nobody has seen in full. The line that could not be read gets a row of
 * its own, written where the application was read rather than here.
 */
export const nestjsHttpAdapter: EntryAdapter = {
  name: 'nestjs-http',
  detect: (pkg) => hasAnyDependency(pkg, ['@nestjs/common']),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];
    const globalPrefix =
      typeof ctx.meta?.['globalPrefix'] === 'string'
        ? (ctx.meta['globalPrefix'] as string)
        : undefined;
    const versioning = versioningIn(ctx.meta);
    const mount = mountIn(ctx.meta);
    // Which applications this service creates, and which of them mounts each
    // controller. An address is only an address within an application: two
    // applications in one service both serving `/health` write one id between
    // them, the builder keeps the node it already has, and the losing file
    // yields no node and no row at all (R119). The cheap fix was a row naming
    // both files; this is the other one, where the identity carries the
    // application and both files contribute a node.
    const applications = applicationsIn(ctx.meta);
    // A route that names no version of its own is served at the default one, and
    // that is not a detail: on novu it is 356 of 415 routes, every one of which
    // was recorded at an address the framework never answers on.
    const defaultVersions: Versions | undefined =
      versioning?.defaultVersion === undefined ? undefined : [versioning.defaultVersion];

    for (const declaration of repoClasses(ctx)) {
      const found = nestDecorators(declaration, ['Controller']);
      const controller = found.matched[0];
      const controllerName = declaration.getName() ?? '<anonymous>';
      const file = fileOfNode(declaration, ctx);
      if (controller === undefined) {
        // A class carrying no `@Controller` at all is most of the repository and
        // says nothing; one carrying something spelled that way from a module
        // this could not place is a reading that failed, and it gets a row.
        reportForeign(ctx, found.foreign, {
          file,
          line: declaration.getStartLineNumber(),
          symbol: controllerName,
        });
        continue;
      }
      const prefix = readControllerPrefix(controller);
      // One entry per application that mounts this controller, which is one
      // entry and no qualifier at all for the ordinary service that creates a
      // single application. The judgement about when an id carries an
      // application is made in one place, so that no two adapters can spell it
      // differently.
      const mountedIn = applicationsServing(
        applications,
        makeSymbolId(ctx.repo, file, controllerName),
      );

      if (prefix.dynamic) {
        ctx.builder.addUnresolved({
          file,
          line: declaration.getStartLineNumber(),
          reason: 'route-path-dynamic',
          hint: 'Give @Controller a literal path; a computed prefix would make every route below it a guess.',
          symbol: controllerName,
          adapter: 'nestjs-http',
        });
        continue;
      }

      for (const method of declaration.getMethods()) {
        const routes = nestDecorators(method, [...ROUTE_DECORATORS.keys()]);
        reportForeign(ctx, routes.foreign, {
          file,
          line: method.getStartLineNumber(),
          symbol: `${controllerName}.${method.getName()}`,
        });
        for (const decorator of routes.matched) {
          // Both spellings, because `import { Get as HttpGet }` is still a GET
          // and the table is keyed by the names Nest exports. A decorator that
          // matched by name and answers to neither is not a thing that exists
          // today; it gets a row rather than a `continue`, because the one thing
          // this reader may not do is drop a route it recognised (R84).
          const httpMethod = decoratorNames(decorator)
            .map((name) => ROUTE_DECORATORS.get(name))
            .find((verb) => verb !== undefined);
          if (httpMethod === undefined) {
            ctx.builder.addUnresolved({
              file,
              line: method.getStartLineNumber(),
              reason: 'entry-http-types-unmatched',
              level: 'info',
              message: `@${decoratorName(decorator)} on ${controllerName}.${method.getName()} came from ${NEST_PACKAGES[0]} and stands for no HTTP method this knows, so no route was read from it.`,
              hint: 'Write the decorator under the name Nest exports it as.',
              symbol: `${controllerName}.${method.getName()}`,
              adapter: 'nestjs-http',
            });
            continue;
          }
          const [pathArg] = decoratorArgs(decorator);

          let paths: string[];
          if (pathArg === undefined) {
            paths = [''];
          } else if (pathArg.resolved) {
            const list = stringListArg(pathArg);
            if (list === undefined) {
              ctx.builder.addUnresolved({
                file,
                line: method.getStartLineNumber(),
                reason: 'route-path-dynamic',
                hint: 'Use a string literal, a const string, or an array of them.',
                symbol: `${controllerName}.${method.getName()}`,
                adapter: 'nestjs-http',
              });
              continue;
            }
            paths = list;
          } else {
            ctx.builder.addUnresolved({
              file,
              line: method.getStartLineNumber(),
              reason: 'route-path-dynamic',
              hint: 'Use a string literal or a const string; a computed path cannot be matched against callers.',
              symbol: `${controllerName}.${method.getName()}`,
              adapter: 'nestjs-http',
            });
            continue;
          }

          // The route's own word, then the controller's, then the application's
          // default. That is the order the framework resolves it in, and each
          // level answers `undefined` only when it said nothing at all.
          const versions = versionsOf(method) ?? prefix.versions ?? defaultVersions ?? [];
          const authNote = authNoteOf(method);
          const handler = handlerOf(method, ctx);
          const otherDecorators = method
            .getDecorators()
            // Under either name: a framework decorator written as an alias is
            // still the framework's, and listing it as one of the handler's own
            // would put `@HttpGet` in the meta of the route it declares.
            .filter((item) => !decoratorNames(item).some((name) => FRAMEWORK_DECORATORS.has(name)))
            .map((item: Decorator) => ({
              name: decoratorName(item),
              args: decoratorArgs(item).map((value) =>
                value.resolved ? value.value : { unresolved: value.text },
              ),
            }));

          for (const served of servedAt(versions, versioning)) {
            for (const controllerPath of prefix.paths) {
              for (const routePath of paths) {
                const rawPath = joinPath(globalPrefix, served.segment, controllerPath, routePath);
                const path = normalizePath(rawPath);
                const key = makeHttpEntryKey(httpMethod, path);
                for (const application of mountedIn) {
                  entries.push({
                    id: makeEntryId(ctx.repo, 'http', key, application),
                    kind: 'http',
                    label:
                      application === undefined
                        ? `${httpMethod} ${path}`
                        : `${httpMethod} ${path} (${application})`,
                    key,
                    handler,
                    file,
                    line: method.getStartLineNumber(),
                    meta: {
                      method: httpMethod,
                      path,
                      rawPath,
                      ...(globalPrefix === undefined ? {} : { globalPrefix }),
                      ...(served.version === undefined ? {} : { version: served.version }),
                      ...(mount !== undefined && path.startsWith(`/${UNREAD_SPAN}`) ? { mount } : {}),
                      controller: controllerName,
                      // Only where there is more than one, which is where it
                      // says something: it is what tells a tie between two
                      // applications from a tie between two routes of one.
                      ...(application === undefined ? {} : { application }),
                      ...(otherDecorators.length > 0 ? { decorators: otherDecorators } : {}),
                      ...(authNote === undefined ? {} : { authNote }),
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
    return entries;
  },
};

/**
 * `@flowatlas-auth a signed header is checked in the body` — a handler saying
 * it refuses a request itself.
 *
 * Some handlers authenticate in their own body: a signed header is resolved and
 * overrides what the client claimed, and a request carrying neither that nor a
 * service token is refused. No guard sits in front of such a route and none
 * should, and static reading cannot see any of it. The annotation is the
 * handler's own word for it, in the shape `@flowatlas-calls` already uses, and
 * it is a `marker` claim like every other: unverifiable, and therefore worth
 * exactly as much as whoever wrote it (R33).
 */
const AUTH = /@flowatlas-auth[ \t]*(.*)/;

const authNoteOf = (method: MethodDeclaration): string | undefined => {
  for (const doc of method.getJsDocs()) {
    const found = AUTH.exec(doc.getInnerText());
    if (found !== null) return found[1]?.trim() === '' ? 'the handler checks the request itself' : (found[1] as string).trim();
  }
  return undefined;
};

export { Node };
