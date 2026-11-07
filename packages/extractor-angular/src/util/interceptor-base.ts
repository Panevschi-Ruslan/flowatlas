import { asksAbsolute, conditionsAround, prefixOfRewrite } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { analyzeBaseUrl, type ApiUrl } from './url.js';

/**
 * The base an interceptor puts in front of every request (P239).
 *
 * The framework's client has no base of its own, and a repository that does
 * not write `environment.apiUrl` into every address writes it once, in an
 * interceptor: `next.handle(req.clone({ url: environment.apiUrl + req.url }))`.
 * Every request the injector's client makes then goes out under it, and the
 * address the call site writes is only the tail. The same defect R114 fixed for
 * a client class holding its base in a field, and the same fix: the base is
 * read where it is written and put in front of the address the graph records.
 *
 * Read only where it is certain. An interceptor runs for every request, so the
 * one condition that changes nothing is whether the address is already
 * absolute, which `underBase` honours anyway. Any other condition in front
 * of the rewrite - a path it skips, a header it looks for - means some requests
 * go out under the base and some do not, and nothing here can tell which: that
 * is a row, and no base. So is a second interceptor rewriting the address, since
 * which runs first, and for which application, is not read.
 */
export interface InterceptorBase {
  /** The base every request of the framework's client goes out under, when one was read. */
  readonly base?: ApiUrl;
  /** Where an interceptor rewrites the address and nothing could be taken from it, and why. */
  readonly unread: ReadonlyArray<{ readonly at: TsNode; readonly why: string }>;
}

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current)) {
    current = current.getExpression();
  }
  return current;
};

/** Whether an expression is the request's own address, `req.url`. */
const isRequestUrl = (node: TsNode, request: TsNode): boolean => {
  const target = unwrap(node);
  if (!Node.isPropertyAccessExpression(target) || target.getName() !== 'url') return false;
  const owner = target.getExpression();
  return Node.isIdentifier(owner) && owner.getSymbol()?.getDeclarations()[0] === request;
};

/**
 * The function an interceptor is, and the request it is handed, when a rewrite
 * is written in one: a class's `intercept(req, next)`, or a function typed as
 * an interceptor or handed a request.
 */
const interceptorOf = (clone: CallExpression): { fn: TsNode; request: TsNode; name: string } | undefined => {
  const fn = clone.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node));
  if (fn === undefined || !Node.isFunctionLikeDeclaration(fn)) return undefined;
  const [request] = fn.getParameters();
  if (request === undefined) return undefined;
  if (Node.isMethodDeclaration(fn)) {
    const owner = fn.getParent();
    const name = Node.isClassDeclaration(owner) ? owner.getName() : undefined;
    return fn.getName() === 'intercept' && name !== undefined ? { fn, request, name } : undefined;
  }
  const holder = fn.getParent();
  if (holder === undefined || !Node.isVariableDeclaration(holder)) {
    return Node.isFunctionDeclaration(fn) && fn.getName() !== undefined && /^HttpRequest\b/.test(request.getTypeNode()?.getText() ?? '')
      ? { fn, request, name: fn.getName() as string }
      : undefined;
  }
  const typed = holder.getTypeNode()?.getText() === 'HttpInterceptorFn' || /^HttpRequest\b/.test(request.getTypeNode()?.getText() ?? '');
  return typed ? { fn, request, name: holder.getName() } : undefined;
};

/** The base a rewrite of the address puts in front of it, read as this reader reads every base. */
const baseOfRewrite = (written: TsNode, request: TsNode, sharedPackages: readonly string[]): ApiUrl | undefined =>
  prefixOfRewrite(written, (node) => isRequestUrl(node, request), (node) => analyzeBaseUrl(node, sharedPackages));

/** Whether the repository registers an interceptor of this name. */
const registered = (name: string, texts: readonly string[]): boolean => {
  const escaped = name.replace(/[$]/g, '\\$');
  const provided = new RegExp(`useClass\\s*:\\s*${escaped}\\b`);
  const listed = new RegExp(`withInterceptors\\(\\s*\\[[^\\]]*\\b${escaped}\\b`);
  return texts.some((text) => provided.test(text) || listed.test(text));
};

/** The base the repository's interceptors put in front of every request, read once. */
export const interceptorBaseOf = (files: readonly SourceFile[], sharedPackages: readonly string[]): InterceptorBase => {
  const texts = files.map((file) => file.getFullText());
  const rewrites: Array<{ at: CallExpression; name: string; base?: ApiUrl; why?: string }> = [];
  files.forEach((file, index) => {
    const text = texts[index] ?? '';
    if (!text.includes('.clone(') || !text.includes('url')) return;
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'clone') continue;
      const [options] = call.getArguments();
      if (options === undefined || !Node.isObjectLiteralExpression(options)) continue;
      const property = options.getProperty('url');
      if (property === undefined) continue;
      const interceptor = interceptorOf(call);
      if (interceptor === undefined || !registered(interceptor.name, texts)) continue;
      const owner = unwrap(callee.getExpression());
      if (!Node.isIdentifier(owner) || owner.getSymbol()?.getDeclarations()[0] !== interceptor.request) continue;
      const written = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      const conditional = conditionsAround(call, interceptor.fn).filter((condition) => !asksAbsolute(condition, (node) => isRequestUrl(node, interceptor.request)));
      if (conditional.length > 0) {
        rewrites.push({ at: call, name: interceptor.name, why: `${interceptor.name} rewrites the address only when ${conditional[0]?.getText().slice(0, 60)}, so which requests go out under the base is not known` });
        continue;
      }
      const base = written === undefined ? undefined : baseOfRewrite(written, interceptor.request, sharedPackages);
      rewrites.push(
        base === undefined
          ? { at: call, name: interceptor.name, why: `${interceptor.name} rewrites the address and the base it puts in front could not be read` }
          : { at: call, name: interceptor.name, base },
      );
    }
  });
  const names = new Set(rewrites.map((rewrite) => rewrite.name));
  if (names.size > 1) {
    const listed = [...names].sort().join(', ');
    return { unread: rewrites.map((rewrite) => ({ at: rewrite.at, why: `${names.size} interceptors rewrite the address (${listed}), and which runs first, and for which application, is not read` })) };
  }
  const unread = rewrites.flatMap((rewrite) => (rewrite.why === undefined ? [] : [{ at: rewrite.at, why: rewrite.why }]));
  const bases = [...new Set(rewrites.flatMap((rewrite) => (rewrite.base === undefined ? [] : [rewrite.base.url])))];
  if (unread.length > 0 || bases.length !== 1) return { unread };
  const base = rewrites.find((rewrite) => rewrite.base !== undefined)?.base;
  return base === undefined ? { unread } : { base, unread };
};
