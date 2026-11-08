import type { ClassDeclaration, Expression, MethodDeclaration, ObjectLiteralExpression } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { ModuleInfo, ModuleKind, ProviderRegistration } from '../modules-index.js';
import { getDecorator, lineOf } from '@flowatlas/core';
import { NEST_COMMON } from '../index-classes.js';
import { isDynamicModuleExpression, resolveClassExpression } from '../util/resolve-class.js';
import { tokenOf, tokensProvidedBy } from './module-tokens.js';
import { definePass } from './types.js';

const arrayProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): Expression[] => {
  const property = literal?.getProperty(name);
  if (property === undefined || !Node.isPropertyAssignment(property)) return [];
  const initializer = property.getInitializer();
  if (initializer === undefined || !Node.isArrayLiteralExpression(initializer)) return [];
  return initializer.getElements();
};

/** Looks through the wrappers an array value is written behind: `[...] as const`, `satisfies`, `!`. */
const unwrapValue = (expr: Node): Node => {
  let current = expr;
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

/** The value a name was declared with, when it is a `const` of this repository. */
const declaredValue = (identifier: Node): Node | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = identifier.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
  return declaration.getInitializer();
};

/** How many names deep an array is followed before it is called unread. */
const FOLLOW_LIMIT = 4;

/** A value the files settle where it is written: a literal, a `const` of one, and the operators a condition is made of. */
type Literal = { readonly value: string | number | boolean | null | undefined };

/**
 * What a condition is, where literals decide it (P261): `true`, a `const`
 * this repository declares with a literal, `!`, `===` / `!==`, `&&` and `||`
 * over such values. Anything read when the application runs -
 * `process.env.X`, a call - decides nothing, and is `undefined`.
 */
const literalOf = (node: Node, depth = 0): Literal | undefined => {
  if (depth > FOLLOW_LIMIT * 4) return undefined;
  const expr = unwrapValue(node);
  if (Node.isTrueLiteral(expr)) return { value: true };
  if (Node.isFalseLiteral(expr)) return { value: false };
  if (Node.isNullLiteral(expr)) return { value: null };
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return { value: expr.getLiteralValue() };
  if (Node.isNumericLiteral(expr)) return { value: expr.getLiteralValue() };
  if (Node.isIdentifier(expr)) {
    if (expr.getText() === 'undefined') return { value: undefined };
    const declared = declaredValue(expr);
    return declared === undefined ? undefined : literalOf(declared, depth + 1);
  }
  if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const operand = literalOf(expr.getOperand(), depth + 1);
    return operand === undefined ? undefined : { value: !operand.value };
  }
  if (Node.isBinaryExpression(expr)) {
    const operator = expr.getOperatorToken().getKind();
    const left = literalOf(expr.getLeft(), depth + 1);
    if (operator === SyntaxKind.AmpersandAmpersandToken && left !== undefined && !left.value) return left;
    if (operator === SyntaxKind.BarBarToken && left !== undefined && Boolean(left.value)) return left;
    const right = literalOf(expr.getRight(), depth + 1);
    if (left === undefined || right === undefined) return undefined;
    switch (operator) {
      case SyntaxKind.AmpersandAmpersandToken:
      case SyntaxKind.BarBarToken:
        return right;
      case SyntaxKind.EqualsEqualsEqualsToken:
        return { value: left.value === right.value };
      case SyntaxKind.ExclamationEqualsEqualsToken:
        return { value: left.value !== right.value };
      default:
        return undefined;
    }
  }
  return undefined;
};

/** The expression a function of this repository answers with, where it is one: its only `return`, or its body. */
const answerOf = (callee: Node): Node | undefined => {
  const symbol = callee.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
  const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  if (fn === undefined || !(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return body;
  const answers: Node[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node) || Node.isArrowFunction(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) {
      const answer = node.getExpression();
      if (answer !== undefined) answers.push(answer);
    }
  });
  const [only] = answers;
  return answers.length === 1 ? only : undefined;
};

/** One entry of `imports:`: where it is written, and the expression that names its module once followed. */
interface ImportedModule {
  readonly written: Expression;
  readonly expr: Expression;
}

/**
 * The modules a list of imports names (P261), each followed to the module it
 * is: a branch a literal condition chooses (`isProduction ? A : B` with
 * `const isProduction = true`), a `const` bound to one, the answer of a
 * function of this repository (`databaseModule()` returning
 * `DatabaseModule.forRoot(...)`), and the elements spread in from an array so
 * chosen. What is not settled is handed back as written, and said where it is
 * read.
 */
const importedModules = (elements: readonly Expression[]): ImportedModule[] => {
  /** The module one entry names: through a decided condition, a `const`, the answer of a function of this repository. */
  const moduleOf = (at: Node, depth: number): Expression => {
    const expr = unwrapValue(at);
    const kept = at as Expression;
    if (depth >= FOLLOW_LIMIT * 2) return kept;
    if (Node.isConditionalExpression(expr)) {
      const decided = literalOf(expr.getCondition());
      return decided === undefined ? kept : moduleOf(decided.value ? expr.getWhenTrue() : expr.getWhenFalse(), depth + 1);
    }
    if (Node.isIdentifier(expr)) {
      const declared = declaredValue(expr);
      return declared === undefined || Node.isClassExpression(unwrapValue(declared)) ? kept : moduleOf(declared, depth + 1);
    }
    if (Node.isCallExpression(expr) && !isDynamicModuleExpression(expr)) {
      const callee = expr.getExpression();
      const answer = Node.isIdentifier(callee) && callee.getText() !== 'forwardRef' ? answerOf(callee) : undefined;
      return answer === undefined ? kept : moduleOf(answer, depth + 1);
    }
    return kept;
  };
  /** The entries a spread puts in: an array's, through a decided condition and a `const`; `undefined` where it is not settled. */
  const listOf = (at: Node, depth: number): Expression[] | undefined => {
    const expr = unwrapValue(at);
    if (depth >= FOLLOW_LIMIT * 2) return undefined;
    if (Node.isArrayLiteralExpression(expr)) return expr.getElements();
    if (Node.isConditionalExpression(expr)) {
      const decided = literalOf(expr.getCondition());
      return decided === undefined ? undefined : listOf(decided.value ? expr.getWhenTrue() : expr.getWhenFalse(), depth + 1);
    }
    const declared = Node.isIdentifier(expr) ? declaredValue(expr) : undefined;
    return declared === undefined ? undefined : listOf(declared, depth + 1);
  };
  const out: ImportedModule[] = [];
  const read = (element: Expression, depth: number): void => {
    if (Node.isOmittedExpression(element)) return;
    if (!Node.isSpreadElement(element)) {
      out.push({ written: element, expr: moduleOf(element, depth) });
      return;
    }
    const items = listOf(element.getExpression(), depth + 1);
    if (items === undefined) out.push({ written: element, expr: element });
    else for (const item of items) read(item, depth + 1);
  };
  for (const element of elements) read(element, 0);
  return out;
};

/**
 * The elements of a list as written, through every spread and name it is
 * assembled from.
 *
 * `providers: [...authProviders, OrdersService]`, with `authProviders` an array
 * declared in another file, is how an application-wide guard is usually put in
 * place, and reading only the literal elements dropped it without a word - the
 * route audit then reported every route of the application as unguarded (P76).
 * What could not be followed is handed back, so a caller can say so.
 */
const listElements = (expr: Node, depth = 0): { items: Expression[]; unread: Node[] } => {
  const value = unwrapValue(expr);
  if (Node.isArrayLiteralExpression(value)) {
    const items: Expression[] = [];
    const unread: Node[] = [];
    for (const element of value.getElements()) {
      if (Node.isSpreadElement(element)) {
        const inner = listElements(element.getExpression(), depth + 1);
        items.push(...inner.items);
        unread.push(...inner.unread);
        continue;
      }
      if (Node.isOmittedExpression(element)) continue;
      items.push(element);
    }
    return { items, unread };
  }
  const declared = depth < FOLLOW_LIMIT ? declaredValue(value) : undefined;
  if (declared !== undefined) return listElements(declared, depth + 1);
  return { items: [], unread: [value] };
};

/** A property's list, through spreads and names; nothing when the property is absent. */
const listProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): { items: Expression[]; unread: Node[] } => {
  const property = literal?.getProperty(name);
  if (property === undefined) return { items: [], unread: [] };
  if (Node.isShorthandPropertyAssignment(property)) return listElements(property.getNameNode());
  if (!Node.isPropertyAssignment(property)) return { items: [], unread: [property] };
  const initializer = property.getInitializer();
  return initializer === undefined ? { items: [], unread: [] } : listElements(initializer);
};

/**
 * The object literals a configuring method returns: `static forRoot() { return
 * { module: AuthModule, providers: [...] }; }`. Only the method's own return
 * statements, not those of a function written inside it.
 */
const returnedModules = (method: MethodDeclaration): ObjectLiteralExpression[] => {
  const body = method.getBody();
  if (body === undefined) return [];
  const answers: Node[] = [];
  if (Node.isBlock(body)) {
    body.forEachDescendant((node, traversal) => {
      if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node) || Node.isArrowFunction(node)) {
        traversal.skip();
        return;
      }
      if (Node.isReturnStatement(node)) {
        const answer = node.getExpression();
        if (answer !== undefined) answers.push(answer);
      }
    });
  } else {
    answers.push(body);
  }
  return answers
    .map(unwrapValue)
    .filter((answer): answer is ObjectLiteralExpression => Node.isObjectLiteralExpression(answer));
};

/**
 * Says where a list of providers could not be read.
 *
 * A provider nobody could read is a token nobody can inject, and if it was an
 * `APP_GUARD` it is a guard in front of every route that nothing here can see.
 * Dropping it in silence is what made an application with one global guard
 * read as an application with none (P76).
 */
const reportUnreadProviders = (ctx: NestExtractContext, owner: string, unread: readonly Node[]): void => {
  for (const node of unread) {
    ctx.report({
      file: ctx.fileOf(node),
      line: lineOf(node),
      reason: 'module-providers-unread',
      hint: 'List the providers, or a name that leads to an array of them in this repository. A guard registered as APP_GUARD among providers that cannot be read is in front of every route, and nothing here can see it.',
      symbol: `${owner} providers ${node.getText().replace(/\s+/g, ' ').slice(0, 80)}`,
    });
  }
};

const moduleOptions = (
  declaration: Parameters<typeof getDecorator>[0],
): ObjectLiteralExpression | undefined => {
  const decorator = getDecorator(declaration, 'Module', NEST_COMMON);
  const [argument] = decorator?.getArguments() ?? [];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

const PROVIDER_SHAPES = ['useClass', 'useValue', 'useFactory', 'useExisting'] as const;

const readProvider = (
  expr: Expression,
  ctx: NestExtractContext,
): ProviderRegistration | undefined => {
  const file = ctx.fileOf(expr);
  const line = lineOf(expr);

  // `const jwtGuard = { provide: APP_GUARD, useClass: JwtGuard }`, listed by name.
  const named = Node.isIdentifier(expr) ? declaredValue(expr) : undefined;
  const namedValue = named === undefined ? undefined : unwrapValue(named);
  if (namedValue !== undefined && Node.isObjectLiteralExpression(namedValue)) {
    const registration = readProvider(namedValue, ctx);
    return registration === undefined ? undefined : { ...registration, file, line };
  }

  if (Node.isObjectLiteralExpression(expr)) {
    const provide = expr.getProperty('provide');
    if (provide === undefined || !Node.isPropertyAssignment(provide)) return undefined;
    const provideValue = provide.getInitializer();
    if (provideValue === undefined) return undefined;
    const token = tokenOf(provideValue);

    for (const shape of PROVIDER_SHAPES) {
      const property = expr.getProperty(shape);
      if (property === undefined || !Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (initializer === undefined) continue;
      if (shape === 'useExisting') {
        return { token, kind: shape, alias: tokenOf(initializer), file, line };
      }
      if (shape === 'useClass') {
        const target = resolveClassExpression(initializer);
        return {
          token,
          kind: shape,
          ...(target.kind === 'local' ? { declaration: target.declaration } : {}),
          ...(target.kind === 'external' ? { installed: { typeName: target.typeName, package: target.package } } : {}),
          file,
          line,
        };
      }
      return { token, kind: shape, file, line };
    }
    return { token, kind: 'useValue', file, line };
  }

  const target = resolveClassExpression(expr);
  if (target.kind === 'local') {
    return {
      token: target.declaration.getName() ?? expr.getText(),
      kind: 'class',
      declaration: target.declaration,
      file,
      line,
    };
  }
  if (target.kind === 'external') {
    return { token: target.typeName, kind: 'class', file, line };
  }
  return undefined;
};

/**
 * Reads every `@Module` and records what it declares.
 *
 * Membership is recorded as metadata on the members rather than as edges: the
 * data model has exactly one module edge, `imports`, and inventing a second one
 * would be a schema change made by accident.
 */
export const modulesPass = definePass('modules', (ctx) => {
  const parsed: ModuleInfo[] = [];
  /** Every `X.forRoot(...)` of a module of this repository, wherever it is imported. */
  const configured: Array<{ expr: Expression; declaration: ClassDeclaration; name: string }> = [];

  for (const indexed of ctx.classes.withRole('module')) {
    const options = moduleOptions(indexed.declaration);
    // Read one element at a time, and said out loud where an element could not
    // be read. `controllers: [...controllers]` — a photo server's, a spread of an array
    // assembled in another file — resolved to nothing and was dropped in
    // silence, which cost little while membership was only metadata on a node.
    // Since R119 it decides which application an address belongs to, so a module
    // whose controller list nobody could read is a module whose addresses cannot
    // be told from another application's, and that is worth a row.
    const controllers: ClassDeclaration[] = [];
    for (const expr of arrayProperty(options, 'controllers')) {
      const ref = resolveClassExpression(expr);
      if (ref.kind === 'local') {
        controllers.push(ref.declaration);
        continue;
      }
      // A controller from an installed package declares addresses this
      // repository does not hold the source of; there is nothing here to mount.
      if (ref.kind === 'external') continue;
      ctx.report({
        file: ctx.fileOf(expr),
        line: lineOf(expr),
        reason: 'module-controllers-unread',
        hint: 'List the controller classes, or a name that leads to an array of them in this repository. Which application serves an address is read from the module that declares its controller.',
        symbol: `${indexed.name} controllers ${ref.text}`,
      });
    }

    const listed = listProperty(options, 'providers');
    reportUnreadProviders(ctx, indexed.name, listed.unread);
    const providers = listed.items
      .map((expr) => readProvider(expr, ctx))
      .filter((provider): provider is ProviderRegistration => provider !== undefined);

    const exports = arrayProperty(options, 'exports').map((expr) => tokenOf(expr));

    const imports: ModuleInfo['imports'] = [];
    const providedByImports: ProviderRegistration[] = [];
    for (const { written, expr } of importedModules(arrayProperty(options, 'imports'))) {
      const dynamic = isDynamicModuleExpression(expr);
      const ref = resolveClassExpression(expr);
      if (ref.kind === 'unknown') {
        ctx.report({
          file: ctx.fileOf(written),
          line: lineOf(written),
          reason: 'module-import-dynamic',
          hint: 'Import a module class, or X.forRoot(...); a computed import cannot be followed.',
          symbol: `${indexed.name} imports ${written === expr ? ref.text : written.getText().replace(/\s+/g, ' ').slice(0, 80)}`,
        });
        continue;
      }
      if (ref.kind === 'external') {
        // `ClientsModule.register([{ name: 'KAFKA_CLIENT' }])` provides that
        // token as surely as `providers:` would (R150); which modules do, and
        // where in their arguments, is described in module-tokens.ts.
        providedByImports.push(...tokensProvidedBy(expr, ref, ctx));
        const node = ctx.ensureExternalClassNode({
          typeName: ref.typeName,
          package: ref.package,
          role: 'module',
        });
        imports.push({ id: node.id, kind: 'external', name: ref.typeName });
        continue;
      }
      const target = ctx.classes.get(ref.declaration);
      if (target === undefined) continue;
      if (dynamic) configured.push({ expr, declaration: ref.declaration, name: target.name });
      imports.push({
        id: target.id,
        declaration: ref.declaration,
        kind: dynamic ? 'dynamic' : 'static',
        name: target.name,
      });
    }

    parsed.push({
      id: indexed.id,
      name: indexed.name,
      file: indexed.file,
      line: indexed.line,
      kind: 'static',
      declaration: indexed.declaration,
      controllers,
      providers,
      providedByImports,
      exports,
      imports,
    });
  }

  // What each configuring method returns under `providers:`, kept on the module
  // it configures, once per method however many modules import it that way.
  const byDeclaration = new Map(parsed.map((info) => [info.declaration, info]));
  const readMethods = new Set<MethodDeclaration>();
  for (const { expr, declaration, name } of configured) {
    const call = unwrapValue(expr);
    if (!Node.isCallExpression(call)) continue;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = declaration.getStaticMethod(callee.getName());
    const info = byDeclaration.get(declaration);
    if (method === undefined || info === undefined || readMethods.has(method)) continue;
    readMethods.add(method);
    const through = `${name}.${callee.getName()}`;
    for (const returned of returnedModules(method)) {
      const listed = listProperty(returned, 'providers');
      reportUnreadProviders(ctx, through, listed.unread);
      for (const item of listed.items) {
        const provider = readProvider(item, ctx);
        if (provider === undefined) continue;
        (info.dynamicProviders ??= []).push({ ...provider, through });
      }
    }
  }

  // Registered before any member node is created, so that each member picks up
  // its owning module in metadata as it is created.
  for (const info of parsed) ctx.modules.add(info);

  for (const info of parsed) {
    ctx.builder.addNode({
      id: info.id,
      type: 'module',
      label: info.name,
      repo: ctx.repo,
      file: info.file,
      line: info.line,
      kind: 'static',
      meta: {
        controllers: info.controllers
          .map((declaration) => ctx.classes.get(declaration)?.name)
          .filter((name): name is string => name !== undefined),
        providers: info.providers.map((provider) => provider.token),
        exports: info.exports,
      },
    });

    for (const imported of info.imports) {
      if (imported.declaration !== undefined) ctx.ensureClassNode(imported.declaration);
      const kind: ModuleKind = imported.kind;
      ctx.builder.addEdge({
        from: info.id,
        to: imported.id,
        type: 'imports',
        confidence: 'static',
        file: info.file,
        line: info.line,
        ...(kind === 'static' ? {} : { meta: { moduleKind: kind } }),
      });
    }
  }
});
