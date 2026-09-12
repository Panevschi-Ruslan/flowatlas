import type {
  FunctionDeclaration,
  Node as TsNode,
  SourceFile,
  VariableDeclaration,
} from 'ts-morph';
import { Node } from 'ts-morph';

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
  declaration: FunctionDeclaration | VariableDeclaration;
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
