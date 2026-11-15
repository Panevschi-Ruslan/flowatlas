import type { ArrowFunction, CallExpression, FunctionDeclaration, FunctionExpression, MethodDeclaration, Node as TsNode, Symbol as TsSymbol } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { handedTo, thisOwnerOf } from './receiver-values.js';

/**
 * Where a request opened on a receiver is sent (P294, P296, P301).
 *
 * `xhr.open('POST', url)` says where a request goes, and `xhr.send(body)`
 * what it carries. The two are often written one after the other, and read so
 * (P294); just as often they are not: an uploader opens the request in one
 * method and sends it in another on the field it keeps it in, a helper opens a
 * request and returns it to the caller that sends it, or hands it to a
 * function that does. The receiver is followed to each: the class's other
 * methods for `this.request`, the module for a value it holds, the function a
 * local value is handed to (its parameter), the callers of a function that
 * returns it (the name they keep it in), and the field it is put in; a
 * receiver the function is handed, to what each caller sends after handing
 * it, and a field of an object written in place, to the object's other
 * methods (P301). A few steps out at most: past that the receiver is
 * somebody else's.
 */

/** How far out the receiver is followed. */
const STEPS = 3;

type FunctionNode = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression;

const isFunction = (node: TsNode): boolean =>
  Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isConstructorDeclaration(node);

/** The function a node is written in, or the file. */
const enclosingScope = (node: TsNode): TsNode => node.getFirstAncestor(isFunction) ?? node.getSourceFile();

/** The first call `<receiver>.<method>(...)` in a scope, after a place where one is given, whose receiver `matches`. */
const firstSend = (scope: TsNode, method: string, matches: (receiver: TsNode) => boolean, after = -1): CallExpression | undefined => {
  let sent: CallExpression | undefined;
  scope.forEachDescendant((node, traversal) => {
    if (sent !== undefined) return traversal.stop();
    if (!Node.isCallExpression(node) || node.getStart() < after) return undefined;
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === method && matches(callee.getExpression())) sent = node;
    return undefined;
  });
  return sent;
};

/** Whether a receiver is the name a symbol is declared by. */
const named = (symbol: TsSymbol) => (receiver: TsNode): boolean => Node.isIdentifier(receiver) && receiver.getSymbol() === symbol;

/** Whether a receiver is `this.<field>`. */
const thisField = (field: string) => (receiver: TsNode): boolean =>
  Node.isPropertyAccessExpression(receiver) && receiver.getExpression().getKind() === SyntaxKind.ThisKeyword && receiver.getName() === field;

/** The function a call reaches, where it is one of the repository's own written in place. */
const calledFunction = (call: CallExpression): FunctionNode | undefined => {
  const callee = call.getExpression();
  const symbol = Node.isPropertyAccessExpression(callee) ? callee.getNameNode().getSymbol() : Node.isIdentifier(callee) ? callee.getSymbol() : undefined;
  let declaration = symbol?.getDeclarations()[0];
  if (declaration !== undefined && (Node.isImportSpecifier(declaration) || Node.isImportClause(declaration))) declaration = symbol?.getAliasedSymbol()?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) return declaration as FunctionNode;
  const initializer = Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isPropertyAssignment(declaration) ? declaration.getInitializer() : undefined;
  return initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) ? (initializer as FunctionNode) : undefined;
};

/** The name a function is called by, where it has one a reference can be found from. */
const nameOf = (fn: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  const holder = fn.getParent();
  return holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) || Node.isPropertyAssignment(holder)) ? holder.getNameNode() : undefined;
};

/** Where a value a symbol names, in a function, is sent: in place, or followed out of the function. */
const sentFrom = (symbol: TsSymbol, within: TsNode, method: string, after: number, steps: number): CallExpression | undefined => {
  const here = firstSend(within, method, named(symbol), after);
  if (here !== undefined || steps <= 0) return here;
  for (const node of within.getDescendants()) {
    if (node.getStart() < after) continue;
    // Handed to a function of the repository: its parameter.
    if (Node.isCallExpression(node)) {
      const index = node.getArguments().findIndex((argument) => named(symbol)(argument));
      const fn = index < 0 ? undefined : calledFunction(node);
      const parameter = fn?.getParameters()[index];
      const own = parameter?.getNameNode();
      const ownSymbol = own !== undefined && Node.isIdentifier(own) ? own.getSymbol() : undefined;
      const sent = ownSymbol === undefined || fn === undefined ? undefined : sentFrom(ownSymbol, fn, method, -1, steps - 1);
      if (sent !== undefined) return sent;
    }
    // Kept in a field of the class: wherever the class sends that field.
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken && named(symbol)(node.getRight())) {
      const left = node.getLeft();
      const owner = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      if (Node.isPropertyAccessExpression(left) && left.getExpression().getKind() === SyntaxKind.ThisKeyword && owner !== undefined) {
        const sent = firstSend(owner, method, thisField(left.getName()));
        if (sent !== undefined) return sent;
      }
    }
  }
  // Returned: wherever each caller keeps what it is given.
  const fn = isFunction(within) ? within : undefined;
  const returns =
    fn !== undefined &&
    fn.getDescendantsOfKind(SyntaxKind.ReturnStatement).some((statement) => {
      const value = statement.getExpression();
      return value !== undefined && named(symbol)(value) && statement.getFirstAncestor(isFunction) === fn;
    });
  const name = returns && fn !== undefined ? nameOf(fn) : undefined;
  if (name === undefined || !Node.isIdentifier(name)) return undefined;
  for (const reference of name.findReferencesAsNodes()) {
    const parent = reference.getParent();
    const callee = parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference ? parent : reference;
    const call = callee.getParent();
    if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== callee) continue;
    const holder = call.getParent();
    if (holder === undefined || !Node.isVariableDeclaration(holder)) continue;
    const kept = holder.getNameNode();
    const keptSymbol = Node.isIdentifier(kept) ? kept.getSymbol() : undefined;
    const sent = keptSymbol === undefined ? undefined : sentFrom(keptSymbol, enclosingScope(holder), method, holder.getEnd(), steps - 1);
    if (sent !== undefined) return sent;
  }
  return undefined;
};

/**
 * The call that sends a request opened by `open` on its receiver,
 * `<receiver>.<method>(...)`: written after it in the function that opens it
 * (P294), or where the receiver is followed to (P296). Nothing where it is
 * sent nowhere that is read.
 */
export const sentThrough = (open: CallExpression, method: string): CallExpression | undefined => {
  const callee = open.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const receiver = callee.getExpression();
  const text = receiver.getText();
  const scope = enclosingScope(open);
  const inPlace = firstSend(scope, method, (each) => each.getText() === text, open.getEnd());
  if (inPlace !== undefined) return inPlace;
  // `this.request.open(...)` in one method, `this.request.send(...)` in
  // another, of a class or an object written in place (P301).
  if (Node.isPropertyAccessExpression(receiver) && receiver.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    const owner = thisOwnerOf(receiver);
    return owner === undefined ? undefined : firstSend(owner, method, thisField(receiver.getName()));
  }
  if (!Node.isIdentifier(receiver)) return undefined;
  const symbol = receiver.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (symbol === undefined || declaration === undefined) return undefined;
  // A value the module holds: wherever the module sends it.
  const home = enclosingScope(declaration);
  if (home === declaration.getSourceFile()) return firstSend(home, method, named(symbol));
  const sent = sentFrom(symbol, home, method, home === scope ? open.getEnd() : -1, STEPS);
  if (sent !== undefined || !Node.isParameterDeclaration(declaration)) return sent;
  // Handed in by the callers (P301): wherever each sends what it handed, after the call.
  for (const handed of handedTo(declaration)) {
    const after = handed.getFirstAncestor((node) => Node.isCallExpression(node) || Node.isNewExpression(node)) ?? handed;
    const there = sentAfter(handed, after, method);
    if (there !== undefined) return there;
  }
  return undefined;
};

/** Where a value a caller hands on is sent after the call it hands it to: a name it holds it by, or a field. */
const sentAfter = (handed: TsNode, call: TsNode, method: string): CallExpression | undefined => {
  if (Node.isPropertyAccessExpression(handed) && handed.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    const owner = thisOwnerOf(handed);
    return owner === undefined ? undefined : firstSend(owner, method, thisField(handed.getName()));
  }
  if (!Node.isIdentifier(handed)) return undefined;
  const symbol = handed.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (symbol === undefined || declaration === undefined) return undefined;
  const home = enclosingScope(declaration);
  if (home === declaration.getSourceFile()) return firstSend(home, method, named(symbol));
  return sentFrom(symbol, enclosingScope(call), method, call.getEnd(), STEPS - 1);
};
