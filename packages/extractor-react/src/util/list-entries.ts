import type { Node as TsNode, ObjectLiteralExpression, ParameterDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * The entries of a list a route table is built from (P291): `configs.map(
 * (config) => <Route path={config.path} component={config.component} />)`
 * over the items a hook, a `const` or a function of the repository hands
 * back, each entry an object written in place.
 */
export interface ListEntries {
  /** The objects written as the list's items. */
  readonly entries: readonly ObjectLiteralExpression[];
  /** Items written as something other than an object in place, or added from code that is not read. */
  readonly unread: number;
}

/** How many steps a list is followed through names, calls and the functions that hand it back. */
const DEPTH = 6;
/** At most this many entries from one list. */
const MOST = 400;

/** The methods of a list that hand back some of its own items, in some order. */
const SUBSET_METHODS: ReadonlySet<string> = new Set(['filter', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'concat']);

/** The methods of a list that add items to it where it is kept: `push(...)`, `unshift(...)`, `splice(at, 0, ...)`. */
const ADDING_METHODS: ReadonlyMap<string, number> = new Map([
  ['push', 0],
  ['unshift', 0],
  ['splice', 2],
]);

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value) || Node.isAwaitExpression(value) || Node.isTypeAssertion(value)) value = value.getExpression();
  return value;
};

/** The expressions a function hands back: its concise body, or each of its own `return`s. */
const returnedBy = (fn: TsNode): TsNode[] => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return [];
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  const found: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) {
      const value = node.getExpression();
      if (value !== undefined) found.push(value);
    }
  });
  return found;
};

/** The function of this repository a callee names, written with a body. */
const calledFunction = (callee: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  const symbol = callee.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) continue;
    if (Node.isFunctionDeclaration(declaration) && declaration.getBody() !== undefined) return declaration;
    if (Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      const fn = value === undefined ? undefined : bare(value);
      if (fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return fn;
    }
    if (Node.isExportAssignment(declaration)) {
      const fn = bare(declaration.getExpression());
      if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) return fn;
      if (Node.isIdentifier(fn)) return calledFunction(fn);
    }
  }
  return undefined;
};

/** The items added to a list kept under a name, by `push`, `unshift` or `splice` written where the name is in scope. */
const addedTo = (declaration: TsNode): TsNode[] => {
  if (!Node.isVariableDeclaration(declaration)) return [];
  const scope = declaration.getFirstAncestor((node) => Node.isBlock(node) || Node.isSourceFile(node));
  if (scope === undefined) return [];
  const name = declaration.getName();
  const added: TsNode[] = [];
  scope.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const from = ADDING_METHODS.get(callee.getName());
    const receiver = bare(callee.getExpression());
    if (from === undefined || !Node.isIdentifier(receiver) || receiver.getText() !== name) return;
    if (!receiver.getSymbol()?.getDeclarations().includes(declaration as never)) return;
    added.push(...node.getArguments().slice(from));
  });
  return added;
};

/**
 * The objects a list expression's items are written as: an array written in
 * place (its spreads followed), a name holding one (with what is pushed onto
 * it), a list's own `filter` / `slice` / `sort` / `concat`, a function of the
 * repository that hands one back, and a call handed a function that hands
 * one back (`useMemo(() => [...])`, a computed value). An item written as
 * anything else is counted as not read.
 */
export const listEntries = (expression: TsNode): ListEntries | undefined => {
  const entries: ObjectLiteralExpression[] = [];
  let unread = 0;
  const seen = new Set<TsNode>();

  const item = (node: TsNode, depth: number): void => {
    const value = bare(node);
    if (Node.isObjectLiteralExpression(value)) {
      if (entries.length < MOST && !entries.includes(value)) entries.push(value);
      return;
    }
    if (Node.isSpreadElement(value)) {
      if (!list(value.getExpression(), depth + 1)) unread += 1;
      return;
    }
    if (Node.isIdentifier(value)) {
      const declaration = (value.getSymbol()?.getAliasedSymbol() ?? value.getSymbol())?.getDeclarations()[0];
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      if (initializer !== undefined && depth < DEPTH) {
        item(initializer, depth + 1);
        return;
      }
    }
    unread += 1;
  };

  /** Whether an expression was read as a list, its items taken. */
  const list = (node: TsNode, depth: number): boolean => {
    if (depth > DEPTH) return false;
    const value = bare(node);
    if (seen.has(value)) return true;
    seen.add(value);
    if (Node.isArrayLiteralExpression(value)) {
      for (const element of value.getElements()) item(element, depth);
      return true;
    }
    if (Node.isConditionalExpression(value)) return [value.getWhenTrue(), value.getWhenFalse()].map((side) => list(side, depth + 1)).some(Boolean);
    if (Node.isBinaryExpression(value) && ['??', '||'].includes(value.getOperatorToken().getText())) {
      return [value.getLeft(), value.getRight()].map((side) => list(side, depth + 1)).some(Boolean);
    }
    if (Node.isIdentifier(value)) {
      const symbol = value.getSymbol();
      const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
      if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return false;
      const initializer = declaration.getInitializer();
      if (initializer === undefined || !list(initializer, depth + 1)) return false;
      for (const added of addedTo(declaration)) item(added, depth + 1);
      return true;
    }
    if (!Node.isCallExpression(value)) return false;
    const callee = value.getExpression();
    if (Node.isPropertyAccessExpression(callee) && SUBSET_METHODS.has(callee.getName())) {
      const read = list(callee.getExpression(), depth + 1);
      if (callee.getName() === 'concat') for (const argument of value.getArguments()) if (!list(argument, depth + 1)) item(argument, depth + 1);
      return read;
    }
    // A function of the repository that hands the list back, then a call handed one that does.
    const fn = calledFunction(callee);
    if (fn !== undefined && returnedBy(fn).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    for (const argument of value.getArguments()) {
      const handed = bare(argument);
      if (!Node.isArrowFunction(handed) && !Node.isFunctionExpression(handed)) continue;
      if (returnedBy(handed).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    }
    return false;
  };

  return list(expression, 0) ? { entries, unread } : undefined;
};

/**
 * The list a value of a route is read from, and the key of its items it
 * reads: `config.path` or a name taken out of the item (`({ path }) => ...`)
 * where `config` is the parameter of a function handed to the list's `map`
 * or `flatMap`.
 */
export const listedKey = (value: TsNode): { readonly list: TsNode; readonly key: string; readonly parameter: ParameterDeclaration } | undefined => {
  const node = bare(Node.isJsxExpression(value) ? (value.getExpression() ?? value) : value);
  let name: TsNode | undefined;
  let key: string | undefined;
  if (Node.isPropertyAccessExpression(node)) {
    name = bare(node.getExpression());
    key = node.getName();
  } else if (Node.isIdentifier(node)) {
    name = node;
  }
  if (name === undefined || !Node.isIdentifier(name)) return undefined;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    let parameter: TsNode | undefined = declaration;
    let taken = key;
    if (Node.isBindingElement(declaration)) {
      // `({ path, component: Screen }) => ...`: the key is the property the name is taken from.
      if (key !== undefined) return undefined;
      taken = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      parameter = declaration.getParent()?.getParent();
    } else if (key === undefined) return undefined;
    if (parameter === undefined || !Node.isParameterDeclaration(parameter) || taken === undefined) continue;
    const fn = parameter.getParent();
    if ((!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== parameter) continue;
    const call = fn.getParent();
    if (call === undefined || !Node.isCallExpression(call) || !call.getArguments().includes(fn as never)) continue;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !['map', 'flatMap'].includes(callee.getName())) continue;
    return { list: callee.getExpression(), key: taken, parameter };
  }
  return undefined;
};
