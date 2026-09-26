import type {
  ClassMethod,
  EntryHandler,
  ExtractContext,
  FunctionHandler,
  InlineHandler,
  NamedFunction,
} from '@flowatlas/core';
import {
  decoratorExportedName,
  decoratorModule,
  decoratorName,
  methodNamedOn,
  namedFunction,
  normalizeFilePath,
  originOfValue,
} from '@flowatlas/core';
import type {
  ClassDeclaration,
  Decorator,
  MethodDeclaration,
  Node as TsNode,
  SourceFile,
} from 'ts-morph';
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

/**
 * The package a module specifier names, or undefined when it names a file.
 *
 * `@nestjs/common/decorators` is `@nestjs/common`: a subpath import of a package
 * is an import of that package, and a reader that matched the specifier exactly
 * skipped every controller written the second way. On novu that was 21 routes in
 * 3 files, dropped with no row to say so, while the classes and the methods
 * around them were read normally — so nothing in the output even hinted that a
 * file had been half read (R84).
 */
export const packageOfSpecifier = (specifier: string): string | undefined => {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  const [first, second] = specifier.split('/');
  if (first === undefined || first === '') return undefined;
  if (!first.startsWith('@')) return first;
  return second === undefined || second === '' ? undefined : `${first}/${second}`;
};

/**
 * The package the function a call names was imported from.
 *
 * `mount('/api', api)` says nothing about itself; `import mount from 'koa-mount'`
 * at the top of the same file says everything, and that is where this reads. The
 * import statement first and the checker second, for the reason `importedAs`
 * below gives at greater length: the statement is there in every state of the
 * repository, including a fixture and a fresh clone where no package resolves,
 * and the checker is the fallback for a namespace import or a re-export it
 * managed to follow. A subpath import is an import of the package, which
 * `packageOfSpecifier` settles.
 *
 * A namespace access is read through to the namespace — `helpers.mount(...)`
 * comes from wherever `helpers` was imported from — because that is the same
 * fact written differently, and a description keyed on the package would
 * otherwise match one spelling of an import and not the other.
 */
export const packageOfCall = (call: TsNode): string | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  const named = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
  if (!Node.isIdentifier(named)) return undefined;
  for (const declaration of named.getSymbol()?.getDeclarations() ?? []) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement === undefined) continue;
    const pkg = packageOfSpecifier(statement.getModuleSpecifierValue());
    if (pkg !== undefined) return pkg;
  }
  const origin = originOfValue(named);
  return origin.kind === 'external' ? origin.package : undefined;
};

/**
 * The identifier a decorator applies, through a call and a namespace access.
 *
 * The same reading core's decorator matcher does, needed here because what this
 * module wants out of it is the import specifier rather than the module alone:
 * the name a package exports and the module it was imported from are one fact
 * written in one place, and asking two questions of two functions is how the
 * second half of R84 came to be answerable only when the checker could resolve
 * the package.
 */
const appliedIdentifier = (decorator: Decorator): TsNode | undefined => {
  const expression = decorator.getExpression();
  const applied = Node.isCallExpression(expression) ? expression.getExpression() : expression;
  if (Node.isPropertyAccessExpression(applied)) return applied.getNameNode();
  return Node.isIdentifier(applied) ? applied : undefined;
};

/**
 * The import a decorator's name is bound by: the module, and the name inside it.
 *
 * Read off the import statement rather than resolved through the checker, and
 * that is the point. `import { Get as HttpGet } from '@nestjs/common/decorators'`
 * says both things in the file, in plain sight, whether or not the package is
 * installed — and a fixture, a fresh clone and a repository whose dependencies
 * do not resolve are all cases where the checker has no aliased symbol to offer
 * and the statement still says everything needed.
 */
const importedAs = (decorator: Decorator): { module: string; name: string } | undefined => {
  const identifier = appliedIdentifier(decorator);
  if (identifier === undefined || !Node.isIdentifier(identifier)) return undefined;
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    return {
      module: declaration.getImportDeclaration().getModuleSpecifierValue(),
      // As written before any `as`, which is the name the package exports.
      name: declaration.getName(),
    };
  }
  return undefined;
};

/**
 * Where a decorator came from, as far as the checker can tell.
 *
 * `unreadable` is not `elsewhere`: a symbol the checker could not follow is a
 * limit of this reading rather than evidence that somebody else exported the
 * name, and the matcher below gives it the benefit of the doubt exactly as the
 * one in core does. Refusing it would drop real routes wherever a re-export
 * cannot be resolved.
 */
export type DecoratorOrigin =
  | { readonly from: 'asked'; readonly package: string }
  | { readonly from: 'elsewhere'; readonly module: string }
  | { readonly from: 'unreadable' };

export const decoratorOrigin = (
  decorator: Decorator,
  packages: readonly string[],
): DecoratorOrigin => {
  // The import statement first, the checker second: the statement is there in
  // every state of the repository, and the checker's answer is what it falls
  // back to for a namespace import or a symbol it followed into a package.
  const module = importedAs(decorator)?.module ?? decoratorModule(decorator);
  if (module === undefined) return { from: 'unreadable' };
  const pkg = packageOfSpecifier(module);
  if (pkg !== undefined && packages.includes(pkg)) return { from: 'asked', package: pkg };
  return { from: 'elsewhere', module };
};

/** A decorator this reader recognised by name and could not place by package. */
export interface ForeignDecorator {
  readonly decorator: Decorator;
  /** The module it was imported from, as written. */
  readonly module: string;
}

/**
 * Decorators named here, told apart by whether these packages exported them.
 *
 * The second list is the whole reason this exists rather than a call to
 * `getDecorator` with a list of module names. A decorator spelled like a
 * framework's and imported from somewhere else is either the framework's after
 * all — re-exported through a barrel this cannot follow — or a local one that
 * happens to share the name, and the reader cannot tell which. What it must not
 * do is treat the two the same as a class carrying no such decorator at all:
 * that is the silence R84 is about, so the caller is handed what it could not
 * place and is expected to write a row about it.
 */
export interface SortedDecorators {
  readonly matched: readonly Decorator[];
  readonly foreign: readonly ForeignDecorator[];
}

export const decoratorsFrom = (
  node: { getDecorators(): Decorator[] },
  names: readonly string[],
  packages: readonly string[],
): SortedDecorators => {
  const matched: Decorator[] = [];
  const foreign: ForeignDecorator[] = [];
  // Matched here rather than by `findDecorators`, because the names this asks
  // about include the one the import statement spells and that function knows
  // only the written name and whatever the checker could alias it to.
  for (const decorator of node.getDecorators()) {
    if (!decoratorNames(decorator).some((name) => names.includes(name))) continue;
    const origin = decoratorOrigin(decorator, packages);
    if (origin.from === 'elsewhere') foreign.push({ decorator, module: origin.module });
    else matched.push(decorator);
  }
  return { matched, foreign };
};

/**
 * Every name a decorator answers to: as written, as imported, as exported.
 *
 * `import { Get as HttpGet }` is still `Get`, and a table keyed by the names a
 * package exports has no answer for the alias. The written name comes first
 * because it is what the file says and nothing can be wrong about it; the
 * imported name comes next because the import statement is there whether or not
 * the package is; the checker's answer comes last, for a name that reached the
 * file some other way.
 */
export const decoratorNames = (decorator: Decorator): readonly string[] => {
  const names = [decoratorName(decorator)];
  for (const name of [importedAs(decorator)?.name, decoratorExportedName(decorator)]) {
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
};

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
export const unwrapValue = (expr: TsNode): TsNode => {
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

/**
 * The call an initializer is, when the value was built by one.
 *
 * The body of a built export is the whole initializer, so the export reaches
 * whatever the code inside the call reaches — which is what a person asking
 * what a route handler touches means, and the reason this edge is worth
 * drawing at all.
 */
const builtValue = (initializer: TsNode | undefined): TsNode | undefined => {
  if (initializer === undefined) return undefined;
  const value = unwrapValue(initializer);
  return Node.isCallExpression(value) ? value : undefined;
};

/** `export const GET = withWorkspace(…)`: the declaration is what the name belongs to. */
const builtFromDeclaration = (declaration: TsNode): NamedFunction | undefined => {
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  // A declaration whose name is a pattern names no single value; its elements
  // do, and they are read below.
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;
  const body = builtValue(declaration.getInitializer());
  if (body === undefined) return undefined;
  return {
    name: declaration.getName(),
    declaration,
    body,
    line: declaration.getStartLineNumber(),
  };
};

/**
 * `export const { POST } = serve<Input>(…)`: one name taken out of a built value.
 *
 * A library that answers several verbs from one configuration hands back an
 * object and the module exports a piece of it, which is a `BindingElement`
 * rather than a declaration of its own. What the name reaches is still the
 * call, because nothing here can tell which part of the returned object the
 * piece is, and the call is what was written.
 *
 * The declaration recorded is the variable declaration around the pattern,
 * which is the node this package's `NamedFunction` can carry. Two names taken
 * out of one call therefore share a declaration, and a reader that keys on the
 * declaration will see the first of them; the names, the ids and the lines
 * stay distinct, which is what every reading downstream of here asks for.
 *
 * Only an element written directly in the declaration's own pattern is read. A
 * name nested a level deeper stands for a piece of a piece, and saying it
 * reaches the call would be claiming more than was written.
 */
const builtFromBindingElement = (element: TsNode): NamedFunction | undefined => {
  if (!Node.isBindingElement(element)) return undefined;
  const name = element.getNameNode();
  if (!Node.isIdentifier(name)) return undefined;
  const declaration = element.getParent()?.getParent();
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const body = builtValue(declaration.getInitializer());
  if (body === undefined) return undefined;
  return { name: name.getText(), declaration, body, line: element.getStartLineNumber() };
};

/**
 * How a built export is read, by the kind of node the export table hands back.
 *
 * A table rather than a chain of tests because the two shapes are two readings
 * of equal standing, and a third — should a framework invent one — is a row
 * here and nothing else.
 */
const BUILT_EXPORT_READINGS: ReadonlyMap<SyntaxKind, (node: TsNode) => NamedFunction | undefined> =
  new Map([
    [SyntaxKind.VariableDeclaration, builtFromDeclaration],
    [SyntaxKind.BindingElement, builtFromBindingElement],
  ]);

/**
 * The function an export stands for when a call built its value.
 *
 * `export const GET = withWorkspace(async (req) => { … })` declares a value, so
 * every reader that asks what a module *declares a function* to be says there
 * is none here — and that is the wrong answer twice over, because this is how
 * a route handler and a wrapped screen are ordinarily written, and because the
 * name an importer writes is the exported one. The React function index reads
 * such an export as a function under its own name (R61); this is the same
 * reading, in one place, so that an adapter naming the code behind a way in and
 * the index that owns the node it points at cannot disagree about what the
 * function behind an export is (R72).
 *
 * What is *not* here any more is the test that the declaration carries an
 * `export` keyword, and its absence is the point rather than an oversight. That
 * test was standing in for the question that actually matters — does the module
 * export this — and it answered wrongly for a value bound to a local name and
 * re-exported under another (`const handler = NextAuth(opts); export { handler
 * as GET, handler as POST }`), which is neither a rare spelling nor a private
 * value. The question is now asked of the module's export table, once, in
 * `builtExportFunctions` below and in the adapter that looks a verb up in the
 * same table. Passing a declaration nobody exports to this function will
 * therefore get an answer, and that is why both callers reach it through an
 * export table: indexing every local `const x = f()` would turn every
 * configured client and every memoised value in a repository into a "function",
 * which is exactly what the old test existed to prevent (R74).
 */
export const builtExportFunction = (declaration: TsNode): NamedFunction | undefined =>
  BUILT_EXPORT_READINGS.get(declaration.getKind())?.(declaration);

/**
 * Every export of a module whose value a call built.
 *
 * Driven by the export table rather than by the variable declarations written
 * in the file, because that table is the one place that already knows what the
 * module exports however it was spelled: a declaration marked `export`, a local
 * re-exported under another name, or a name taken out of a pattern.
 *
 * Two things the table hands back are deliberately dropped. A declaration that
 * lives in another file arrives here through `export { x } from './other'`, and
 * indexing it under this file would put a second node where the other module's
 * reader already made one. And one declaration exported under two names is one
 * function, recorded under the name it was declared with, because that is the
 * name the node carries and the one an adapter naming the same declaration will
 * compute.
 */
export const builtExportFunctions = (sourceFile: SourceFile): NamedFunction[] => {
  const found = new Map<TsNode, NamedFunction>();
  for (const [, declarations] of sourceFile.getExportedDeclarations()) {
    for (const declaration of declarations) {
      if (declaration.getSourceFile() !== sourceFile) continue;
      if (found.has(declaration)) continue;
      const fn = builtExportFunction(declaration);
      if (fn !== undefined) found.set(declaration, fn);
    }
  }
  return [...found.values()];
};
