import type {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node as TsNode,
  PropertyAssignment,
  SourceFile,
  VariableDeclaration,
} from 'ts-morph';
import { Node, VariableDeclarationKind } from 'ts-morph';
import { lineAndColumnAt, startLineOf } from './line-numbers.js';

/**
 * A function with a name, however it was written.
 *
 * `function send() {}` and `const send = () => {}` are the same thing to a
 * reader and to a call, and a table of handlers holds both spellings without
 * distinguishing them.
 */
export interface NamedFunction {
  name: string;
  /** The declaration itself, which is what a set of already-visited ones is keyed on. */
  declaration:
    | FunctionDeclaration
    | VariableDeclaration
    | ArrowFunction
    | FunctionExpression
    | PropertyAssignment
    | MethodDeclaration;
  /** The body, for walking the calls inside it. */
  body: TsNode;
  line: number;
}

/** The named function a declaration stands for, or undefined when it is not one. */
export const namedFunction = (declaration: TsNode): NamedFunction | undefined => {
  if (Node.isFunctionDeclaration(declaration)) {
    const name = declaration.getName();
    const body = declaration.getBody();
    // An overload signature has a name and no body; the implementation below it
    // is the one that runs.
    if (name === undefined || body === undefined) return undefined;
    return { name, declaration, body, line: startLineOf(declaration) };
  }
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  if (initializer === undefined) return undefined;
  if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
    return undefined;
  }
  return {
    name: declaration.getName(),
    declaration,
    body: initializer.getBody(),
    line: startLineOf(declaration),
  };
};

/**
 * Named functions declared at the top of a module.
 *
 * Only the top level, because that is what another module can name and so what a
 * registration can hold. A function declared inside another one is reachable
 * only through the one around it.
 */
export const moduleFunctions = (sourceFile: SourceFile): NamedFunction[] => {
  const found: NamedFunction[] = [];
  for (const declaration of sourceFile.getFunctions()) {
    const fn = namedFunction(declaration);
    if (fn !== undefined) found.push(fn);
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const fn = namedFunction(declaration);
    if (fn !== undefined) found.push(fn);
  }
  return found;
};

/**
 * A function written in place, named by what it was written for.
 *
 * The name carries the line it starts on, so two registrations in one file that
 * read alike are still two functions.
 */
export const inlineFunction = (
  fn: ArrowFunction | FunctionExpression | MethodDeclaration,
  label: string,
): NamedFunction => {
  const line = startLineOf(fn);
  return { name: `${label}@${line}`, declaration: fn, body: fn.getBody() ?? fn, line };
};

/**
 * What a function written in place is written for, as a name: the value it is
 * kept under and the call it is handed to.
 *
 * `export const bookingsProcedure = authedProcedure.use(async ({ ctx }) => …)`
 * is `bookingsProcedure.use`, `describe('orders', () => …)` is `describe`, and a
 * function set as a member of an object handed to a call is that member:
 * `config({ setup: () => … })` is `setup`. Nothing here knows what `use` means;
 * the name says where the function is, which is all a name is for when the
 * source gave none.
 *
 * One answer for everything that names such a function, because two things do:
 * the walk that reads its body and the reader that draws it in front of a way in
 * (R157). Were they to differ, one function would be two nodes.
 */
export const placeOf = (fn: ArrowFunction | FunctionExpression): string => {
  const parent = fn.getParent();
  let handedTo: string | undefined;
  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression();
    if (Node.isPropertyAccessExpression(callee)) handedTo = callee.getName();
    else if (Node.isIdentifier(callee)) handedTo = callee.getText();
  } else if (Node.isPropertyAssignment(parent)) {
    handedTo = parent.getName();
  }
  const holder = fn.getFirstAncestor(
    (node) => Node.isVariableDeclaration(node) || Node.isExportAssignment(node),
  );
  const keptAs = Node.isVariableDeclaration(holder)
    ? Node.isIdentifier(holder.getNameNode())
      ? holder.getName()
      : undefined
    : holder === undefined
      ? undefined
      : 'default';
  const parts = [keptAs, handedTo].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? '(module)' : parts.join('.');
};

/** A function written in place, named by where it is (`placeOf`). */
export const placedFunction = (fn: ArrowFunction | FunctionExpression): NamedFunction =>
  inlineFunction(fn, placeOf(fn));

/**
 * The function written in place that starts at a position, when one does.
 *
 * The innermost one wins, so a handler that itself passes an arrow along is still
 * found as the handler rather than as what it passes.
 */
export const functionAt = (
  sourceFile: SourceFile,
  line: number,
  column: number,
): ArrowFunction | FunctionExpression | MethodDeclaration | undefined => {
  let found: ArrowFunction | FunctionExpression | MethodDeclaration | undefined;
  sourceFile.forEachDescendant((node) => {
    // A method written in an object literal is a function written in place too:
    // `resolvers: { Query: { orders() {…} } }` (P232).
    const objectMethod = Node.isMethodDeclaration(node) && Node.isObjectLiteralExpression(node.getParent());
    if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node) && !objectMethod) return;
    const at = lineAndColumnAt(sourceFile, node.getStart());
    if (at.line === line && at.column === column) found = node;
  });
  return found;
};

/** An expression without the parentheses, casts and `satisfies` written round it. */
const bareValue = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isSatisfiesExpression(value)) {
    value = value.getExpression();
  }
  return value;
};

type FunctionBody = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;

const isFunctionBody = (node: TsNode): node is FunctionBody =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/** The name a function is known by: its own, the `const` it is bound to, or its class's and its own. */
const functionName = (fn: FunctionBody): string | undefined => {
  if (Node.isFunctionDeclaration(fn)) return fn.getName();
  if (Node.isMethodDeclaration(fn)) {
    const owner = fn.getParent();
    const ownerName = Node.isClassDeclaration(owner) ? owner.getName() : undefined;
    return ownerName === undefined ? undefined : `${ownerName}.${fn.getName()}`;
  }
  let holder: TsNode | undefined = fn.getParent();
  while (holder !== undefined && (Node.isParenthesizedExpression(holder) || Node.isAsExpression(holder) || Node.isSatisfiesExpression(holder))) holder = holder.getParent();
  return holder !== undefined && Node.isVariableDeclaration(holder) && Node.isIdentifier(holder.getNameNode()) ? holder.getName() : undefined;
};

/** What a function hands back where it ends: its concise body, or what each of its own `return`s says. */
const returnedValues = (fn: FunctionBody): TsNode[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [bareValue(body)];
  const out: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (isFunctionBody(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (!Node.isReturnStatement(node)) return;
    const value = node.getExpression();
    if (value !== undefined) out.push(bareValue(value));
  });
  return out;
};

/**
 * What an object written down whole is held as, for naming its members: the
 * `const` it is bound to, the function that hands it back, or the module's
 * default export.
 *
 * `const OrdersGateway = () => ({ listOrders() {…} })` hands back an object whose
 * members are functions of their own: `export default OrdersGateway()` and then
 * `OrdersGateway.listOrders(id)` runs the method written in the literal, and the
 * checker says so - the member's declaration is that method. Named by the
 * factory and the member, `OrdersGateway.listOrders`, as a member of a `const`
 * object is named by the object (P276).
 */
const holderOfObject = (literal: TsNode): string | undefined => {
  let at: TsNode | undefined = literal.getParent();
  while (at !== undefined && (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isSatisfiesExpression(at))) at = at.getParent();
  if (at === undefined) return undefined;
  if (Node.isVariableDeclaration(at)) {
    if (at.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
    return Node.isIdentifier(at.getNameNode()) ? at.getName() : undefined;
  }
  if (Node.isExportAssignment(at)) return 'default';
  // The concise body of a function, or what one of its own `return`s says.
  const fn = Node.isReturnStatement(at) ? at.getFirstAncestor(isFunctionBody) : isFunctionBody(at) ? at : undefined;
  if (fn === undefined) return undefined;
  if (!returnedValues(fn).includes(bareValue(literal))) return undefined;
  return functionName(fn);
};

/**
 * The function a member of an object literal is, when the declaration is one
 * and the object is held where it can be named (`holderOfObject`): a method
 * written in the literal, a member given a function written in place, or a
 * member given a function of this repository by its name (`{ listOrders }`).
 */
export const objectMemberFunction = (declaration: TsNode): NamedFunction | undefined => {
  const literal = declaration.getParent();
  if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return undefined;
  const holder = holderOfObject(literal);
  if (holder === undefined) return undefined;
  if (Node.isMethodDeclaration(declaration)) {
    const body = declaration.getBody();
    return body === undefined ? undefined : { name: `${holder}.${declaration.getName()}`, declaration, body, line: startLineOf(declaration) };
  }
  if (Node.isPropertyAssignment(declaration)) {
    const value = declaration.getInitializer();
    const bare = value === undefined ? undefined : bareValue(value);
    if (bare === undefined || (!Node.isArrowFunction(bare) && !Node.isFunctionExpression(bare))) return undefined;
    return { name: `${holder}.${declaration.getName()}`, declaration, body: bare.getBody(), line: startLineOf(declaration) };
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    const named = declaration.getValueSymbol()?.getDeclarations()[0];
    return named === undefined ? undefined : namedFunction(named);
  }
  return undefined;
};

/**
 * The functions a function hands back as the members of one object it writes
 * whole: `const OrdersGateway = () => ({ listOrders() {…}, placeOrder: async () => … })`
 * (P276). Empty where it hands back anything else, or more than one object.
 */
export const factoryMembers = (fn: NamedFunction): NamedFunction[] => {
  const declared = Node.isVariableDeclaration(fn.declaration) ? fn.declaration.getInitializer() : fn.declaration;
  const body = declared === undefined ? undefined : bareValue(declared);
  if (body === undefined || !isFunctionBody(body)) return [];
  const returned = returnedValues(body);
  const [literal] = returned;
  if (returned.length !== 1 || literal === undefined || !Node.isObjectLiteralExpression(literal)) return [];
  return literal.getProperties().flatMap((property) => {
    if (Node.isShorthandPropertyAssignment(property)) return [];
    const member = objectMemberFunction(property);
    return member === undefined ? [] : [member];
  });
};

/**
 * Whether a function does nothing but hand back the object of functions it
 * writes - no statement before the `return`, nothing called on the way - so
 * that its members are the whole of its body (P276).
 */
export const onlyHandsBackMembers = (fn: NamedFunction): boolean => {
  if (factoryMembers(fn).length === 0) return false;
  const body = fn.body;
  if (!Node.isBlock(body)) return true;
  const statements = body.getStatements();
  return statements.length === 1 && Node.isReturnStatement(statements[0]);
};

/**
 * A function held in an object written down whole: `commands.myOrders`.
 *
 * `export const commands = { myOrders: async (ctx) => … }` is a module of
 * functions spelled as an object. A call through it names one of them as surely
 * as calling a function by name, provided the object is a `const` of this
 * repository whose member is written in it.
 */
export const memberFunction = (receiver: TsNode, member: string): NamedFunction | undefined => {
  const declaration = receiver.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return undefined;
  }
  const initializer = declaration.getInitializer();
  if (initializer === undefined || !Node.isObjectLiteralExpression(initializer)) return undefined;
  const property = initializer.getProperty(member);
  const name = `${declaration.getName()}.${member}`;
  const line = startLineOf(property ?? declaration);
  if (property !== undefined && Node.isMethodDeclaration(property)) {
    const body = property.getBody();
    return body === undefined ? undefined : { name, declaration: property, body, line };
  }
  if (property === undefined || !Node.isPropertyAssignment(property)) return undefined;
  const value = property.getInitializer();
  if (value === undefined || (!Node.isArrowFunction(value) && !Node.isFunctionExpression(value))) {
    return undefined;
  }
  return { name, declaration: property, body: value.getBody(), line };
};
