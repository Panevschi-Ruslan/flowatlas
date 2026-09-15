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
    return { name, declaration, body, line: declaration.getStartLineNumber() };
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
    line: declaration.getStartLineNumber(),
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
  fn: ArrowFunction | FunctionExpression,
  label: string,
): NamedFunction => {
  const line = fn.getStartLineNumber();
  return { name: `${label}@${line}`, declaration: fn, body: fn.getBody(), line };
};

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
): ArrowFunction | FunctionExpression | undefined => {
  let found: ArrowFunction | FunctionExpression | undefined;
  sourceFile.forEachDescendant((node) => {
    if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) return;
    const at = sourceFile.getLineAndColumnAtPos(node.getStart());
    if (at.line === line && at.column === column) found = node;
  });
  return found;
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
  const line = property?.getStartLineNumber() ?? declaration.getStartLineNumber();
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
