import {
  declarationOf,
  defaultHeadersWritten,
  headersAHookAdds,
  joinHookHeaders,
  NO_HOOK_HEADERS,
  PLATFORM_HEADERS,
  writtenHeaderNames,
  type HookHeaders,
} from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';

/**
 * The headers a server's request carries from the client it is made
 * through (P265): what an instance is made with, what the functions
 * registered to run before each of its requests add, and what a module that
 * configures the framework's client writes.
 *
 * The browser readers read an instance where it is made; a server writes the
 * same three things in the same places - `axios.create({ headers })`,
 * `api.interceptors.request.use(fn)`, and in NestJS `HttpModule.register({
 * headers })` with interceptors on `httpService.axiosRef` - so a request to a
 * procedure whose input takes a header is compared with the ones its client
 * adds, and not told it sends none. What a function does to the headers is
 * read by the core's one reading (`headersAHookAdds`), and so is a default
 * header written to a client (`api.defaults.headers.common[...] = ...`,
 * `defaultHeadersWritten`, P276): a name written plainly is carried by every
 * request the client makes, as an interceptor's is.
 *
 * Which client a request goes through is decided by what its call is made
 * on: the module itself, the framework's injected client (by its package,
 * `@nestjs/axios`), or a name holding an instance, followed to where it is
 * made. A receiver that is none of these says nothing, as before.
 */

/** What a client adds to every request made through it. */
export type ClientHeaders = HookHeaders;

/** The module a client's requests are made on, by its package. */
const MODULE = 'axios';

/** How many names a receiver is followed through to where its instance is made. */
const DEPTH = 4;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current)) {
    current = current.getExpression();
  }
  return current;
};

/** Whether a name is the client's module, by its import. */
const isModule = (node: TsNode): boolean => {
  const target = unwrap(node);
  if (!Node.isIdentifier(target)) return false;
  return (target.getSymbol()?.getDeclarations() ?? []).some((declaration) => declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === MODULE);
};

/** The headers an options object written in place writes: names, `unread`, or none. */
const headersInOptions = (options: TsNode | undefined): HookHeaders => {
  if (options === undefined) return NO_HOOK_HEADERS;
  const object = unwrap(options);
  if (!Node.isObjectLiteralExpression(object)) return { keys: [], unread: true };
  if (object.getProperties().some((property) => Node.isSpreadAssignment(property))) return { keys: [], unread: true };
  const property = object.getProperty('headers');
  if (property === undefined) return NO_HOOK_HEADERS;
  const written = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
  const names = written === undefined ? undefined : writtenHeaderNames(written, [PLATFORM_HEADERS]);
  return names === undefined ? { keys: [], unread: true } : { keys: names, unread: false };
};

/** The one object a function answers with, where it is written as one: `useFactory: () => ({ headers })`. */
const answeredBy = (fn: TsNode | undefined): TsNode | undefined => {
  if (fn === undefined) return undefined;
  const target = unwrap(fn);
  if (!Node.isArrowFunction(target) && !Node.isFunctionExpression(target)) return undefined;
  const body = target.getBody();
  if (!Node.isBlock(body)) return body;
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((each) => each.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node)) === target);
  return returns.length === 1 ? returns[0]?.getExpression() : undefined;
};

/** The key a receiver is filed under: the module, the framework's client, or the declaration holding an instance. */
type ClientKey = 'module' | 'framework' | TsNode;

export const serverClientHeaders = (files: () => readonly SourceFile[], packageOf: (node: TsNode) => string | undefined) => {
  let registered: Map<ClientKey, TsNode[]> | undefined;
  const defaulted = new Map<ClientKey, HookHeaders[]>();
  let defaultedUnplaced = false;
  let configured: HookHeaders = NO_HOOK_HEADERS;

  /** The declaration a name of an instance is held by, followed to the one whose value makes it. */
  const holderOf = (node: TsNode): TsNode | undefined => {
    let current = unwrap(node);
    for (let depth = 0; depth < DEPTH; depth += 1) {
      if (!Node.isIdentifier(current) && !Node.isPropertyAccessExpression(current)) return undefined;
      const declaration = declarationOf(current);
      if (declaration === undefined) return undefined;
      const value = Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
      const inner = value === undefined ? undefined : unwrap(value);
      if (inner === undefined || !(Node.isIdentifier(inner) || Node.isPropertyAccessExpression(inner)) || isModule(inner)) return declaration;
      current = inner;
    }
    return undefined;
  };

  const keyOf = (receiver: TsNode): ClientKey | undefined => {
    const target = unwrap(receiver);
    if (isModule(target)) return 'module';
    // `this.http.axiosRef`: the framework's client's own instance.
    if (Node.isPropertyAccessExpression(target) && target.getName() === 'axiosRef') return 'framework';
    if (packageOf(target) === '@nestjs/axios') return 'framework';
    return holderOf(target);
  };

  const scan = (): Map<ClientKey, TsNode[]> => {
    if (registered !== undefined) return registered;
    const found = new Map<ClientKey, TsNode[]>();
    registered = found;
    const modules: HookHeaders[] = [];
    for (const file of files()) {
      const text = file.getFullText();
      const registers = text.includes('interceptors');
      const configures = text.includes('HttpModule');
      const defaults = text.includes('.defaults.headers');
      if (!registers && !configures && !defaults) continue;
      if (registers || configures) {
        for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const callee = unwrap(call.getExpression());
          if (!Node.isPropertyAccessExpression(callee)) continue;
          // `api.interceptors.request.use(fn)`.
          const request = unwrap(callee.getExpression());
          if (callee.getName() === 'use' && Node.isPropertyAccessExpression(request) && request.getName() === 'request') {
            const interceptors = unwrap(request.getExpression());
            if (!Node.isPropertyAccessExpression(interceptors) || interceptors.getName() !== 'interceptors') continue;
            const key = keyOf(interceptors.getExpression());
            const [fn] = call.getArguments();
            if (key === undefined || fn === undefined) continue;
            found.set(key, [...(found.get(key) ?? []), fn]);
            continue;
          }
          // `HttpModule.register({ headers })`, `registerAsync({ useFactory: () => ({ headers }) })`.
          if (unwrap(callee.getExpression()).getText() !== 'HttpModule') continue;
          const [options] = call.getArguments();
          if (callee.getName() === 'register') modules.push(headersInOptions(options));
          else if (callee.getName() === 'registerAsync') {
            const object = options === undefined ? undefined : unwrap(options);
            const factory = object !== undefined && Node.isObjectLiteralExpression(object) ? object.getProperty('useFactory') : undefined;
            const value = factory !== undefined && Node.isPropertyAssignment(factory) ? factory.getInitializer() : undefined;
            const answered = answeredBy(value);
            modules.push(answered === undefined ? { keys: [], unread: true } : headersInOptions(answered));
          }
        }
      }
      if (defaults) {
        for (const node of [...file.getDescendantsOfKind(SyntaxKind.BinaryExpression), ...file.getDescendantsOfKind(SyntaxKind.DeleteExpression)]) {
          const written = defaultHeadersWritten(node);
          if (written === undefined) continue;
          // What the defaults are written on: the expression before `.defaults`.
          const key = keyOf(written.owner);
          if (key === undefined) defaultedUnplaced = true;
          else defaulted.set(key, [...(defaulted.get(key) ?? []), written.headers]);
        }
      }
    }
    // Two modules writing different headers: which one a service's client is configured by is not read.
    const distinct = new Set(modules.map((each) => JSON.stringify(each)));
    configured = distinct.size > 1 ? { keys: [], unread: true } : (modules[0] ?? NO_HOOK_HEADERS);
    return found;
  };

  /** What an instance a holder makes is made with: the headers of `axios.create(options)`. */
  const madeWith = (holder: TsNode): HookHeaders => {
    const value = Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) ? holder.getInitializer() : undefined;
    const made = value === undefined ? undefined : unwrap(value);
    if (made === undefined || !Node.isCallExpression(made)) return NO_HOOK_HEADERS;
    const callee = unwrap(made.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'create' || !isModule(callee.getExpression())) return NO_HOOK_HEADERS;
    return headersInOptions(made.getArguments()[0]);
  };

  /**
   * What the client a request's call is made on adds to it; `undefined`
   * where the call is made on no client this follows.
   */
  return (call: CallExpression): ClientHeaders | undefined => {
    const callee = unwrap(call.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const key = keyOf(callee.getExpression());
    if (key === undefined) return undefined;
    const fns = scan().get(key) ?? [];
    const hooks = fns.map((fn) => {
      const target = unwrap(fn);
      const declared = Node.isIdentifier(target) ? declarationOf(target) : undefined;
      const written = declared !== undefined && Node.isVariableDeclaration(declared) ? declared.getInitializer() : declared;
      return headersAHookAdds(written ?? target, 'options', [PLATFORM_HEADERS]);
    });
    const own = key === 'module' ? NO_HOOK_HEADERS : key === 'framework' ? configured : madeWith(key);
    // An instance is made with its module's defaults, and keeps what is written to its own (P276).
    const defaults = [...(defaulted.get(key) ?? []), ...(key === 'module' || key === 'framework' ? [] : (defaulted.get('module') ?? []))];
    const parts = [own, ...hooks, ...defaults, defaultedUnplaced ? { keys: [], unread: true } : NO_HOOK_HEADERS];
    return joinHookHeaders(parts);
  };
};
