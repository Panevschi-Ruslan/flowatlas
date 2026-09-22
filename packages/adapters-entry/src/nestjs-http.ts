import type { EntryAdapter, EntryNode } from '@flowatlas/core';
import { hasAnyDependency, makeEntryId, makeHttpEntryKey, normalizePath } from '@flowatlas/core';
import {
  decoratorArgs,
  decoratorName,
  findDecorators,
  getDecorator,
  stringListArg,
} from '@flowatlas/extractor-nestjs';
import { Node, type MethodDeclaration } from 'ts-morph';
import { fileOfNode, handlerOf, joinPath, repoClasses } from './shared.js';

const NEST_COMMON = ['@nestjs/common'] as const;

/** Decorator name to HTTP method. `All` stands for every method at once. */
const ROUTE_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: 'ALL',
};

const FRAMEWORK_DECORATORS = new Set([
  ...Object.keys(ROUTE_DECORATORS),
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

interface ControllerPrefix {
  paths: string[];
  version?: string;
  dynamic: boolean;
}

/** `@Controller('x')`, `@Controller(['x','y'])` and `@Controller({ path, version })`. */
const readControllerPrefix = (declaration: Parameters<typeof getDecorator>[0]): ControllerPrefix => {
  const decorator = getDecorator(declaration, 'Controller', NEST_COMMON);
  if (decorator === undefined) return { paths: [''], dynamic: false };
  const [first] = decoratorArgs(decorator);
  if (first === undefined) return { paths: [''], dynamic: false };
  if (!first.resolved) return { paths: [''], dynamic: true };

  const asList = stringListArg(first);
  if (asList !== undefined) return { paths: asList, dynamic: false };

  if (typeof first.value === 'object' && first.value !== null) {
    const options = first.value as { path?: unknown; version?: unknown };
    const paths =
      typeof options.path === 'string'
        ? [options.path]
        : Array.isArray(options.path)
          ? options.path.filter((item): item is string => typeof item === 'string')
          : [''];
    return {
      paths: paths.length > 0 ? paths : [''],
      ...(typeof options.version === 'string' ? { version: options.version } : {}),
      dynamic: false,
    };
  }
  return { paths: [''], dynamic: true };
};

const versionOf = (node: Parameters<typeof getDecorator>[0]): string | undefined => {
  const decorator = getDecorator(node, 'Version', NEST_COMMON);
  if (decorator === undefined) return undefined;
  const [first] = decoratorArgs(decorator);
  return first !== undefined && first.resolved && typeof first.value === 'string'
    ? first.value
    : undefined;
};

/**
 * HTTP routes.
 *
 * The path recorded is the one the framework prints at start-up, global prefix
 * included, so that counting entries against that log is a meaningful check. The
 * prefix is also kept on its own, because a client calling the service may not
 * include it.
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

    for (const declaration of repoClasses(ctx)) {
      const controller = getDecorator(declaration, 'Controller', NEST_COMMON);
      if (controller === undefined) continue;
      const prefix = readControllerPrefix(declaration);
      const controllerName = declaration.getName() ?? '<anonymous>';
      const file = fileOfNode(declaration, ctx);

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
        for (const decorator of findDecorators(method, {
          names: Object.keys(ROUTE_DECORATORS),
          fromModules: NEST_COMMON,
        })) {
          const httpMethod = ROUTE_DECORATORS[decoratorName(decorator)];
          if (httpMethod === undefined) continue;
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

          const version = versionOf(method) ?? prefix.version;
          const authNote = authNoteOf(method);
          const handler = handlerOf(method, ctx);
          const otherDecorators = method
            .getDecorators()
            .filter((item) => !FRAMEWORK_DECORATORS.has(decoratorName(item)))
            .map((item: import("ts-morph").Decorator) => ({
              name: decoratorName(item),
              args: decoratorArgs(item).map((value) =>
                value.resolved ? value.value : { unresolved: value.text },
              ),
            }));

          for (const controllerPath of prefix.paths) {
            for (const routePath of paths) {
              const rawPath = joinPath(globalPrefix, controllerPath, routePath);
              const path = normalizePath(rawPath);
              entries.push({
                id: makeEntryId(ctx.repo, 'http', makeHttpEntryKey(httpMethod, path)),
                kind: 'http',
                label: `${httpMethod} ${path}`,
                key: makeHttpEntryKey(httpMethod, path),
                handler,
                file,
                line: method.getStartLineNumber(),
                meta: {
                  method: httpMethod,
                  path,
                  rawPath,
                  ...(globalPrefix === undefined ? {} : { globalPrefix }),
                  ...(version === undefined ? {} : { version }),
                  controller: controllerName,
                  ...(otherDecorators.length > 0 ? { decorators: otherDecorators } : {}),
                  ...(authNote === undefined ? {} : { authNote }),
                },
              });
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
