import type {
  ClassMethod,
  EntryHandler,
  ExtractContext,
  FunctionHandler,
  InlineHandler,
  NamedFunction,
} from '@flowatlas/core';
import { methodNamedOn, namedFunction, normalizeFilePath, originOfValue } from '@flowatlas/core';
import type { ClassDeclaration, MethodDeclaration, Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/** Files of the repository, ignoring anything that came from a package. */
export const repoSources = function* (ctx: ExtractContext): Generator<SourceFile> {
  for (const sourceFile of ctx.project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes('/node_modules/')) continue;
    yield sourceFile;
  }
};

/** Classes of the repository, ignoring anything that came from a package. */
export const repoClasses = function* (ctx: ExtractContext): Generator<ClassDeclaration> {
  for (const sourceFile of repoSources(ctx)) yield* sourceFile.getClasses();
};

export const fileOfNode = (node: { getSourceFile(): SourceFile }, ctx: ExtractContext): string =>
  normalizeFilePath(node.getSourceFile().getFilePath(), ctx.repoDir);

export const handlerOf = (method: ClassMethod, ctx: ExtractContext) => {
  const owner = method.getParent() as ClassDeclaration;
  return {
    file: fileOfNode(method, ctx),
    className: owner.getName() ?? '<anonymous>',
    methodName: method.getName(),
    line: method.getStartLineNumber(),
  };
};

export const handlerOfFunction = (fn: NamedFunction, ctx: ExtractContext): FunctionHandler => ({
  file: fileOfNode(fn.declaration, ctx),
  functionName: fn.name,
  line: fn.line,
});

/**
 * The named function an expression stands for, when it stands for one declared
 * here.
 *
 * A registration holds a function by name, and the name is what the graph can
 * point at. An arrow written in the call has no name and comes back undefined,
 * which is a fact about the code rather than a failure to read it.
 */
export const repoFunctionOf = (node: TsNode | undefined): NamedFunction | undefined => {
  if (node === undefined) return undefined;
  const origin = originOfValue(node);
  return origin.kind === 'local' ? namedFunction(origin.declaration) : undefined;
};

/** A function written where a handler was expected, or undefined for anything else. */
const inlineFunction = (argument: TsNode | undefined): TsNode | undefined =>
  argument !== undefined &&
  (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument))
    ? argument
    : undefined;

/**
 * The one thing a set of calls delegates to, when they delegate to one thing.
 *
 * A method of the class the registration is written in, or a function of this
 * repository called by name. One such call is an answer; several is a
 * dispatcher, and pointing at any one of them would claim a route through code
 * the way in may never reach.
 */
const handlerAmong = (
  calls: readonly TsNode[],
  owner: ClassDeclaration | undefined,
  ctx: ExtractContext,
): EntryHandler | undefined => {
  const found = new Map<string, EntryHandler>();
  for (const call of calls) {
    if (!Node.isCallExpression(call)) continue;
    const callee = call.getExpression();

    if (Node.isIdentifier(callee)) {
      const fn = repoFunctionOf(callee);
      if (fn !== undefined) found.set(fn.name, handlerOfFunction(fn, ctx));
      continue;
    }

    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;
    // `this.handle()` where `handle = () => {}` is a method like any other,
    // and it is how a handler keeps its `this` when a library holds it (R29).
    const method = owner === undefined ? undefined : methodNamedOn(owner, callee.getName());
    if (method !== undefined) found.set(callee.getName(), handlerOf(method, ctx));
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
};

/**
 * The code a function written in the registration really runs.
 *
 * Every call in it is considered, because a registration written for one button
 * holds that button's code and nothing else: whatever it names is what the
 * button does.
 */
export const handlerInside = (
  argument: TsNode | undefined,
  owner: ClassDeclaration | undefined,
  ctx: ExtractContext,
): EntryHandler | undefined => {
  const fn = inlineFunction(argument);
  if (fn === undefined) return undefined;
  return handlerAmong(fn.getDescendantsOfKind(SyntaxKind.CallExpression), owner, ctx);
};

/** `await x`, `(x)` and `x as T` all stand for whatever is inside them. */
const unwrapValue = (expr: TsNode): TsNode => {
  if (Node.isAwaitExpression(expr)) return unwrapValue(expr.getExpression());
  if (Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr)) {
    return unwrapValue(expr.getExpression());
  }
  return expr;
};

/**
 * The same, for a function that answers something rather than doing it.
 *
 * Only what the function gives back is considered. An inline route handler is
 * plumbing and then an answer — boot the container, read the body, and then
 * hand over — and the plumbing is usually the only part written as a call to a
 * function of this repository. Reading every call made `getNestContext` the
 * code behind eight of the real project's worker routes, which is where the
 * request starts rather than where it is answered.
 *
 * A call whose result is bound to a name and used further down is not an answer
 * by this rule, and that is the point: the function carried on afterwards.
 */
export const handlerReturned = (
  argument: TsNode | undefined,
  owner: ClassDeclaration | undefined,
  ctx: ExtractContext,
): EntryHandler | undefined => {
  const fn = inlineFunction(argument);
  if (fn === undefined) return undefined;

  const body = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getBody() : undefined;
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return handlerAmong([unwrapValue(body)], owner, ctx);

  const returned: TsNode[] = [];
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    // A `return` inside a function written within this one belongs to that one.
    const inside = statement.getFirstAncestor(
      (at) =>
        Node.isArrowFunction(at) || Node.isFunctionExpression(at) || Node.isFunctionDeclaration(at),
    );
    if (inside !== fn) continue;
    const expression = statement.getExpression();
    if (expression !== undefined) returned.push(unwrapValue(expression));
  }
  return handlerAmong(returned, owner, ctx);
};

/**
 * The declaration a call is written inside, and the handler that stands for.
 *
 * A registration that hands over a function written in place says nothing about
 * which code answers it beyond "whatever is around this call", and that is what
 * the enclosing method or function is.
 */
export const enclosingHandler = (call: TsNode, ctx: ExtractContext): EntryHandler | undefined => {
  for (let at = call.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isMethodDeclaration(at)) return handlerOf(at, ctx);
    if (Node.isFunctionDeclaration(at) || Node.isVariableDeclaration(at)) {
      const fn = namedFunction(at);
      if (fn !== undefined) return handlerOfFunction(fn, ctx);
    }
    if (Node.isSourceFile(at)) return undefined;
  }
  return undefined;
};

/** The class a call is written inside, when it is written inside one. */
export const enclosingClass = (call: TsNode): ClassDeclaration | undefined => {
  for (let at = call.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isClassDeclaration(at)) return at;
    if (Node.isSourceFile(at)) return undefined;
  }
  return undefined;
};

/** Joins path segments the way a router does, then normalises the result. */
export const joinPath = (...segments: ReadonlyArray<string | undefined>): string => {
  const parts = segments
    .filter((segment): segment is string => segment !== undefined && segment !== '')
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part !== '');
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
};

/**
 * The handler a function written in the registration stands for, found again by
 * where it starts; undefined when the argument is not one.
 */
export const inlineHandlerOf = (
  argument: TsNode | undefined,
  label: string,
  ctx: ExtractContext,
): InlineHandler | undefined => {
  if (argument === undefined || (!Node.isArrowFunction(argument) && !Node.isFunctionExpression(argument))) {
    return undefined;
  }
  const sourceFile = argument.getSourceFile();
  const at = sourceFile.getLineAndColumnAtPos(argument.getStart());
  return { file: fileOfNode(argument, ctx), line: at.line, column: at.column, label, inline: true };
};
