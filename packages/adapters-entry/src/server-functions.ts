import type { EntryAdapter, EntryNode, EntryWrapping, ExtractContext } from '@flowatlas/core';
import { evaluateExpression, hasAnyDependency, makeEntryId, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  fileOfNode,
  handlerOfFunction,
  inlineHandlerOf,
  packageOfCall,
  repoFunctionOf,
  repoSources,
  unwrapValue,
} from './shared.js';

const ADAPTER = 'tanstack-start';

/** The packages a server function is made from, any one of which turns the reader on. */
const START_PACKAGES = ['@tanstack/react-start', '@tanstack/solid-start', '@tanstack/start'];

/** The function that starts the chain. */
const MAKER = 'createServerFn';

/** The verb a server function is sent with when its options name none. */
const DEFAULT_METHOD = 'GET';

/** How far a chain is walked back from `.handler(...)` to the maker. */
const MAX_LINKS = 16;

/**
 * Functions a TanStack Start application runs on the server and the browser
 * calls by importing them (P270).
 *
 * `createServerFn({ method: 'POST' }).validator(...).handler(async ({ data })
 * => ...)` is a boundary between two processes with no address written
 * anywhere: the browser imports the value and calls it, and what happens at run
 * time is a request to the server the build assigns. So each is a way in of
 * its own, an `rpc` reached by import exactly as a Next server action is, and
 * the extractor joins every call of the export to it. The verb is the one its
 * options write, `GET` where they write none, as the library does; what its
 * `.middleware([...])` installs stands in front of it.
 *
 * Read wherever the chain is written in the repository, exported or not: a
 * server function kept to one module is still a request when that module calls
 * it from the browser. A chain whose `.handler` is handed something that is not
 * a function, or that is not the whole value of a variable, is named in a row,
 * because the boundary is real and nothing can name it.
 */
export const tanstackStartAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, START_PACKAGES),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];
    for (const sourceFile of repoSources(ctx)) entries.push(...serverFunctionsIn(sourceFile, ctx));
    return entries;
  },
};

/** One chain, from the maker's call to the `.handler(...)` that ends it. */
interface Chain {
  maker: CallExpression;
  handlerCall: CallExpression;
  middleware: TsNode[];
}

/** The chain a `.handler(...)` call ends, when it starts at the library's maker. */
const chainEndedBy = (call: CallExpression): Chain | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'handler') return undefined;
  const middleware: TsNode[] = [];
  let at: TsNode = callee.getExpression();
  for (let links = 0; links < MAX_LINKS; links += 1) {
    const node = unwrapValue(at);
    if (!Node.isCallExpression(node)) return undefined;
    const inner = node.getExpression();
    if (Node.isIdentifier(inner)) {
      if (inner.getText() !== MAKER) return undefined;
      const pkg = packageOfCall(node);
      return pkg !== undefined && START_PACKAGES.includes(pkg) ? { maker: node, handlerCall: call, middleware } : undefined;
    }
    if (!Node.isPropertyAccessExpression(inner)) return undefined;
    if (inner.getName() === 'middleware') {
      const [list] = node.getArguments();
      const written = list === undefined ? undefined : unwrapValue(list);
      if (written !== undefined && Node.isArrayLiteralExpression(written)) middleware.unshift(...written.getElements());
    }
    at = inner.getExpression();
  }
  return undefined;
};

/** The verb the maker's options write, or the library's default. */
const methodOf = (maker: CallExpression): string => {
  const [options] = maker.getArguments();
  if (options === undefined) return DEFAULT_METHOD;
  const value = evaluateExpression(options);
  if (!value.resolved || typeof value.value !== 'object' || value.value === null) return DEFAULT_METHOD;
  const method = (value.value as Record<string, unknown>)['method'];
  return typeof method === 'string' ? method.toUpperCase() : DEFAULT_METHOD;
};

/** The variable a chain is the whole value of. */
const declaredAs = (chain: Chain): TsNode | undefined => {
  let at: TsNode = chain.handlerCall;
  for (let parent = at.getParent(); parent !== undefined; at = parent, parent = parent.getParent()) {
    if (Node.isVariableDeclaration(parent)) return parent.getInitializer() === at ? parent : undefined;
    if (!(Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent) || Node.isParenthesizedExpression(parent))) {
      return undefined;
    }
  }
  return undefined;
};

const serverFunctionsIn = (sourceFile: SourceFile, ctx: ExtractContext): EntryNode[] => {
  const entries: EntryNode[] = [];
  const file = fileOfNode(sourceFile, ctx);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const chain = chainEndedBy(call);
    if (chain === undefined) continue;
    const declaration = declaredAs(chain);
    const [argument] = chain.handlerCall.getArguments();
    const work = argument === undefined ? undefined : unwrapValue(argument);
    const named = repoFunctionOf(work);
    const written = work !== undefined && (Node.isArrowFunction(work) || Node.isFunctionExpression(work));
    if (declaration === undefined || !Node.isVariableDeclaration(declaration) || (named === undefined && !written)) {
      ctx.builder.addUnresolved({
        file,
        line: startLineOf(call),
        reason: 'server-action-unread',
        message:
          declaration === undefined
            ? `A server function is made here and is not the whole value of a variable, so nothing names what the browser imports and calls.`
            : `A server function's .handler(...) is handed ${work?.getText().slice(0, 40) ?? 'nothing'}, which is not a function this can point at.`,
        hint: 'Declare it as `export const name = createServerFn(...).handler(async (...) => ...)`, so the boundary can be named and joined to its callers.',
        symbol: `${MAKER}(...).handler`,
        adapter: ADAPTER,
      });
      continue;
    }
    const name = declaration.getName();
    const key = `serverfn:${file}#${name}`;
    const method = methodOf(chain.maker);
    const line = startLineOf(declaration);
    const wrapping: EntryWrapping[] = chain.middleware.map((element) => ({
      label: element.getText().replace(/\s+/g, ' ').slice(0, 40),
      layer: 'middleware',
      scope: 'route',
      source: `${MAKER}().middleware`,
      file,
      line: startLineOf(element),
      kind: 'function',
    }));
    const handler =
      named !== undefined ? handlerOfFunction(named, ctx) : inlineHandlerOf(work, `server function ${name}`, ctx);
    entries.push({
      id: makeEntryId(ctx.repo, 'rpc', key),
      kind: 'rpc',
      label: `server function ${name}`,
      key,
      ...(handler === undefined ? {} : { handler }),
      file,
      line,
      ...(wrapping.length === 0 ? {} : { wrapping }),
      meta: {
        serverFunction: name,
        method,
        adapter: ADAPTER,
        registration: `${MAKER}().handler`,
        exported: declaration.getVariableStatement()?.isExported() === true,
        // No address joins this to a caller; the import does, as it does for a
        // server action, and the extractor draws each call of the export.
        viaImport: true,
        handlerVia: named !== undefined ? 'function' : 'inline',
      },
    });
  }
  return entries;
};
