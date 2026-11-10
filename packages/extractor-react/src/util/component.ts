import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';

/** The functions that hand a component on: `memo(Row)`, `forwardRef(Field)`, `observer(Page)`. */
const WRAPPERS = new Set(['memo', 'forwardRef', 'observer']);

/** How many steps a name is followed to the component it stands for: a lazy loader, a module handing on another's export, a wrapper. */
const MOST_STEPS = 16;

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value)) value = value.getExpression();
  return value;
};

const declarationsOf = (node: TsNode): TsNode[] => {
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  return (symbol.getAliasedSymbol() ?? symbol).getDeclarations();
};

/**
 * The module a call loads lazily, where one of its arguments is a function
 * handing back `import('./Orders')`: React's `lazy`, and any loader of the
 * repository or of a package written the same way - `loadable(...)`,
 * `loadScreen(...)`, a loader that retries (P288).
 */
const lazilyLoaded = (call: TsNode): TsNode | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  for (const argument of call.getArguments()) {
    const fn = bare(argument);
    if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) continue;
    let body: TsNode | undefined = fn.getBody();
    if (body !== undefined && Node.isBlock(body)) {
      const statements = body.getStatements();
      const [only] = statements;
      body = statements.length === 1 && only !== undefined && Node.isReturnStatement(only) ? only.getExpression() : undefined;
    }
    const imported = body === undefined ? undefined : bare(body);
    if (imported === undefined || !Node.isCallExpression(imported) || imported.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [specifier] = imported.getArguments();
    if (specifier !== undefined && (Node.isStringLiteral(specifier) || Node.isNoSubstitutionTemplateLiteral(specifier))) return specifier;
  }
  return undefined;
};

/** The component a module hands out as its default export. */
const defaultComponentOf = (ctx: ReactExtractContext, specifier: TsNode, depth: number): IndexedFunction | undefined => {
  const exported = specifier.getSymbol()?.getExports().find((symbol) => symbol.getName() === 'default');
  for (const declaration of (exported?.getAliasedSymbol() ?? exported)?.getDeclarations() ?? []) {
    const found = componentDeclared(ctx, declaration, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** The component a declaration is, or hands on. */
const componentDeclared = (ctx: ReactExtractContext, declaration: TsNode, depth: number): IndexedFunction | undefined => {
  if (depth > MOST_STEPS) return undefined;
  const indexed = ctx.functions.get(declaration as never);
  if (indexed !== undefined && indexed.role === 'component') return indexed;
  // `export default observer(Home)`, `export default Orders`.
  if (Node.isExportAssignment(declaration)) return componentIn(ctx, declaration.getExpression(), depth + 1);
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const value = declaration.getInitializer();
  return value === undefined ? undefined : componentIn(ctx, value, depth + 1);
};

/**
 * The component of this repository an expression stands for: a name,
 * through imports and the functions that hand a component on (`memo`,
 * `forwardRef`, `observer`), a lazily loaded module's default export
 * (`lazy(() => import('./Orders'))`, however the loader is named), and a
 * member of an object a lazy loader hands back - `Screens.Home.Component`,
 * where `Home = loadScreen(() => import('./Home'))` hands back the
 * component with its `preload` (P288).
 */
export const componentIn = (ctx: ReactExtractContext, expression: TsNode, depth = 0): IndexedFunction | undefined => {
  if (depth > MOST_STEPS) return undefined;
  const value = bare(expression);
  if (Node.isJsxExpression(value)) {
    const inner = value.getExpression();
    return inner === undefined ? undefined : componentIn(ctx, inner, depth + 1);
  }
  if (Node.isJsxSelfClosingElement(value)) return componentIn(ctx, value.getTagNameNode(), depth + 1);
  if (Node.isJsxElement(value)) return componentIn(ctx, value.getOpeningElement().getTagNameNode(), depth + 1);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    const called = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
    const [first] = value.getArguments();
    if (WRAPPERS.has(called) && first !== undefined) return componentIn(ctx, first, depth + 1);
    const loaded = lazilyLoaded(value);
    return loaded === undefined ? undefined : defaultComponentOf(ctx, loaded, depth);
  }
  if (Node.isIdentifier(value)) {
    for (const declaration of declarationsOf(value)) {
      const found = componentDeclared(ctx, declaration, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Node.isPropertyAccessExpression(value)) {
    // A component exported from a module read as a namespace: `Screens.Orders`.
    for (const declaration of declarationsOf(value.getNameNode())) {
      const found = componentDeclared(ctx, declaration, depth + 1);
      if (found !== undefined) return found;
    }
    // `Screens.Home.Component`: a member of what a lazy loader hands back is the module it loads.
    const holder = bare(value.getExpression());
    if (!/^[A-Z]/.test(value.getName())) return undefined;
    for (const declaration of Node.isIdentifier(holder) || Node.isPropertyAccessExpression(holder) ? declarationsOf(Node.isPropertyAccessExpression(holder) ? holder.getNameNode() : holder) : []) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const made = declaration.getInitializer();
      const loaded = made === undefined ? undefined : lazilyLoaded(bare(made));
      if (loaded !== undefined) return defaultComponentOf(ctx, loaded, depth);
    }
  }
  return undefined;
};
