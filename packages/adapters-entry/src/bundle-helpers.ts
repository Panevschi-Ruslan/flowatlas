import { Node, SyntaxKind, type ArrowFunction, type FunctionDeclaration, type FunctionExpression, type MethodDeclaration, type Node as TsNode, type SourceFile } from 'ts-morph';
import { unwrapValue } from './shared.js';

/**
 * The helpers a bundler writes into a build, told by what their bodies do
 * rather than by their names, so that a minified build renaming them is read
 * as one that keeps them (P355):
 *
 * - `wrapper`: a CommonJS module wrapper - esbuild's `__commonJS`, rolldown's
 *   `__commonJSMin` - that makes `{ exports: {} }` and calls the factory it is
 *   handed (its first parameter) with it;
 * - `loader`: webpack's `__webpack_require__`, one parameter, the id, by which
 *   it indexes a table of factories and calls the one there, with a fresh
 *   `{ exports: {} }`;
 * - `export`: esbuild's `__export` and webpack's `__webpack_require__.d`,
 *   which walk the keys of their second parameter (`for (k in all)`) and
 *   define each on the first with `get: all[k]`;
 * - `interop`: a function handing a module's value through on its way in or
 *   out - rollup's `getDefaultExportFromCjs`, esbuild's `__toESM` and
 *   `__toCommonJS`, TypeScript's `__importDefault`, Babel's
 *   `_interopRequireDefault` - short, reading its first parameter and
 *   speaking of `__esModule`.
 *
 * A function of none of these shapes is none of them, whatever it is named.
 */
export type HelperShape = 'wrapper' | 'loader' | 'export' | 'interop';

type HelperFunction = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;

const isHelperFunction = (node: TsNode): node is HelperFunction =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/** A helper is short: a body longer than this is a module's own code, not a bundler's helper. */
const MOST_HELPER_TEXT = 1500;

/** `(0, x)`, as a bundle calls a function without a receiver: the `x`. */
const lastOfCommas = (node: TsNode): TsNode => {
  let value = unwrapValue(node);
  while (Node.isBinaryExpression(value) && value.getOperatorToken().getKind() === SyntaxKind.CommaToken) value = unwrapValue(value.getRight());
  return value;
};

/**
 * The function a name or an expression is written as, without following any
 * property: the function itself, a function declared under the name, the one
 * a variable starts as, the right side of `this && this.x || function () {}`.
 */
export const functionWritten = (node: TsNode | undefined, depth = 0): HelperFunction | undefined => {
  if (node === undefined || depth > 4) return undefined;
  const value = lastOfCommas(node);
  if (isHelperFunction(value)) return value;
  if (Node.isBinaryExpression(value) && ['||', '??'].includes(value.getOperatorToken().getText())) return functionWritten(value.getRight(), depth + 1);
  if (!Node.isIdentifier(value)) return undefined;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  return Node.isVariableDeclaration(declaration) ? functionWritten(declaration.getInitializer(), depth + 1) : undefined;
};

const SHAPES = new WeakMap<TsNode, HelperShape | null>();

/** The shape of bundler's helper a function is, by its body, or nothing. */
export const helperShapeOf = (fn: TsNode | undefined): HelperShape | undefined => {
  if (fn === undefined || !isHelperFunction(fn)) return undefined;
  const known = SHAPES.get(fn);
  if (known !== undefined) return known ?? undefined;
  const shape = shapeOf(fn) ?? null;
  SHAPES.set(fn, shape);
  return shape ?? undefined;
};

const shapeOf = (fn: HelperFunction): HelperShape | undefined => {
  const parameters = fn.getParameters();
  const body = fn.getBody();
  if (body === undefined || parameters.length === 0 || body.getText().length > MOST_HELPER_TEXT) return undefined;
  /** Whether a node names the parameter at a place. */
  const isParameter = (node: TsNode | undefined, at: number): boolean => {
    if (node === undefined) return false;
    const value = unwrapValue(node);
    const parameter = parameters[at];
    return parameter !== undefined && Node.isIdentifier(value) && value.getSymbol()?.getDeclarations()[0] === parameter;
  };
  // `{ exports: {} }` - webpack 4 `{ i: id, l: false, exports: {} }`: the module object a wrapper or a loader makes.
  const makesModule = body.getDescendantsOfKind(SyntaxKind.PropertyAssignment).some((property) => {
    if (property.getName().replace(/^['"]|['"]$/g, '') !== 'exports') return false;
    const value = property.getInitializer();
    const object = value === undefined ? undefined : unwrapValue(value);
    return object !== undefined && Node.isObjectLiteralExpression(object) && object.getProperties().length === 0;
  });
  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  /** A call's callee as a bundle writes it: `(0, f)` the `f`, `f.call` the `f`. */
  const calleeOf = (call: TsNode & { getExpression(): TsNode }): TsNode => {
    let callee = lastOfCommas(call.getExpression());
    if (Node.isPropertyAccessExpression(callee) && ['call', 'apply'].includes(callee.getName())) callee = lastOfCommas(callee.getExpression());
    return callee;
  };
  // `for (k in all) define(target, k, { get: all[k] })`.
  if (parameters.length >= 2) {
    const walksKeys = body.getDescendantsOfKind(SyntaxKind.ForInStatement).some((loop) => {
      if (!isParameter(loop.getExpression(), 1)) return false;
      return loop.getDescendantsOfKind(SyntaxKind.PropertyAssignment).some((property) => {
        const value = property.getInitializer();
        const read = value === undefined ? undefined : unwrapValue(value);
        return property.getName() === 'get' && read !== undefined && Node.isElementAccessExpression(read) && isParameter(read.getExpression(), 1);
      });
    });
    if (walksKeys) return 'export';
  }
  if (makesModule) {
    // `table[id](module, module.exports, require)`: a table of factories indexed by the one parameter.
    const indexesTable =
      parameters.length === 1 &&
      calls.some((call) => {
        const callee = calleeOf(call);
        return Node.isElementAccessExpression(callee) && !isParameter(callee.getExpression(), 0) && isParameter(callee.getArgumentExpression(), 0);
      });
    if (indexesTable) return 'loader';
    // `cb((mod = { exports: {} }).exports, mod)`, `(0, cb[names(cb)[0]])(...)`: the factory handed, called.
    const callsFactory = calls.some((call) => {
      const callee = calleeOf(call);
      return isParameter(callee, 0) || (Node.isElementAccessExpression(callee) && isParameter(callee.getExpression(), 0));
    });
    if (callsFactory) return 'wrapper';
  }
  const speaksOfEsModule = body.getDescendants().some((node) => (Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) && (Node.isIdentifier(node) ? node.getText() : node.getLiteralValue()) === '__esModule');
  const readsFirst = body.getDescendantsOfKind(SyntaxKind.Identifier).some((name) => isParameter(name, 0));
  return speaksOfEsModule && readsFirst ? 'interop' : undefined;
};

/** The shape of helper a call's callee is written as, followed through names only. */
export const calleeShapeOf = (callee: TsNode): HelperShape | undefined => helperShapeOf(functionWritten(callee));

const LOADERS = new WeakMap<SourceFile, HelperFunction | null>();

/** A file's webpack loader: the function named `__webpack_require__`, or the one written in its shape. */
export const webpackLoaderOf = (sourceFile: SourceFile): HelperFunction | undefined => {
  const known = LOADERS.get(sourceFile);
  if (known !== undefined) return known ?? undefined;
  const declared = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  const found = declared.find((each) => each.getName() === '__webpack_require__') ?? declared.find((each) => helperShapeOf(each) === 'loader');
  LOADERS.set(sourceFile, found ?? null);
  return found;
};

const HELPERS = new WeakMap<SourceFile, boolean>();

/** Whether a file holds any bundler's helper of a shape known: a bundled build, minified or not. */
export const holdsBundlerHelpers = (sourceFile: SourceFile): boolean => {
  const known = HELPERS.get(sourceFile);
  if (known !== undefined) return known;
  const found =
    webpackLoaderOf(sourceFile) !== undefined ||
    [...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction), ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)].some((fn) => {
      const shape = helperShapeOf(fn);
      return shape === 'wrapper' || shape === 'export';
    });
  HELPERS.set(sourceFile, found);
  return found;
};
