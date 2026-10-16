import { lineOf } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type Expression, type Identifier } from 'ts-morph';
import {
  EXCEPTION_STATUS,
  HTTP_EXCEPTION,
  HTTP_STATUS,
  STATUSLESS_EXCEPTIONS,
  UNKNOWN_ERROR_STATUS,
} from './statuses.js';

/** One `throw` written in a body. */
export interface Thrown {
  exception: string;
  status?: number;
  line: number;
}

/** What a name in `new Name(...)` stands for. */
export interface NamedClass {
  /** The name it is exported under, which is the name the framework knows. */
  name: string;
  /** The module it is imported from, when it is imported. */
  module?: string;
  /** Its declaration, when it is a class written in this project. */
  declaration?: ClassDeclaration;
  /** Declared by the language itself: `Error`, `TypeError`. */
  builtIn?: boolean;
}

/** How many classes up a chain of `extends` is followed. */
const MAX_BASES = 8;

const isLibraryFile = (path: string): boolean => /[\\/]typescript[\\/]lib[\\/]lib\./.test(path);

/** Whatever a name in a `new` or an `extends` refers to. */
export const classNamed = (identifier: Identifier): NamedClass => {
  const symbol = identifier.getSymbol();
  const written = identifier.getText();
  if (symbol === undefined) return { name: written };
  for (const declaration of symbol.getDeclarations()) {
    if (isLibraryFile(declaration.getSourceFile().getFilePath())) return { name: written, builtIn: true };
    if (Node.isClassDeclaration(declaration)) {
      // A class an installed package declares is known by its name; its
      // typings say nothing about what the framework answers it with.
      if (declaration.getSourceFile().isDeclarationFile()) return { name: declaration.getName() ?? written, module: 'installed' };
      return { name: declaration.getName() ?? written, declaration };
    }
    if (Node.isImportSpecifier(declaration)) {
      const module = declaration.getImportDeclaration().getModuleSpecifierValue();
      const aliased = symbol
        .getAliasedSymbol()
        ?.getDeclarations()
        .find((found) => Node.isClassDeclaration(found) && !found.getSourceFile().isDeclarationFile());
      return {
        name: declaration.getName(),
        module,
        ...(aliased === undefined ? {} : { declaration: aliased as ClassDeclaration }),
      };
    }
  }
  return { name: written };
};

/** A status written as a number or as a member of `HttpStatus`. */
export const statusWritten = (expression: Node | undefined): number | undefined => {
  if (expression === undefined) return undefined;
  if (Node.isNumericLiteral(expression)) return Number(expression.getLiteralValue());
  if (Node.isPropertyAccessExpression(expression)) return HTTP_STATUS.get(expression.getName());
  return undefined;
};

/** The arguments a class hands its base, from the `super(...)` in its constructor. */
const superArguments = (declaration: ClassDeclaration): Node[] | undefined => {
  for (const constructor of declaration.getConstructors()) {
    for (const call of constructor.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() === SyntaxKind.SuperKeyword) return call.getArguments();
    }
  }
  return undefined;
};

/**
 * The status an exception class answers with, built with these arguments.
 *
 * A class of the framework's is a row of the table. One written here is read
 * through its `extends` to the first class that is, handing on what its
 * constructor passes to `super`. Anything that reaches no exception of the
 * framework's is what the framework answers an unknown error with.
 */
export const statusOfClass = (named: NamedClass, args: readonly Node[], depth = 0): number | undefined => {
  if (named.declaration === undefined) {
    if (named.name === HTTP_EXCEPTION) return statusWritten(args[1]);
    const known = EXCEPTION_STATUS.get(named.name);
    if (known !== undefined) return known;
    if (STATUSLESS_EXCEPTIONS.has(named.name)) return undefined;
    // A class of an installed package nothing here can read may be one of the
    // framework's under another name; a guess would be worse than nothing.
    return named.builtIn === true || named.module === undefined ? UNKNOWN_ERROR_STATUS : undefined;
  }
  const base = named.declaration.getExtends()?.getExpression();
  if (base === undefined || !Node.isIdentifier(base) || depth >= MAX_BASES) return UNKNOWN_ERROR_STATUS;
  return statusOfClass(classNamed(base), superArguments(named.declaration) ?? args, depth + 1);
};

/** True when a `try` around the throw, inside this body, catches it. */
const caughtWithin = (thrown: Node, body: Node): boolean => {
  for (let at = thrown.getParent(); at !== undefined && at !== body; at = at.getParent()) {
    const parent = at.getParent();
    if (parent !== undefined && Node.isTryStatement(parent) && parent.getTryBlock() === at && parent.getCatchClause() !== undefined) {
      return true;
    }
  }
  return false;
};

/** What `throw new X(...)` throws, or nothing for a rethrow or a value built elsewhere. */
const thrownBy = (expression: Expression | undefined): Omit<Thrown, 'line'> | undefined => {
  if (expression === undefined || !Node.isNewExpression(expression)) return undefined;
  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;
  const named = classNamed(callee);
  const status = statusOfClass(named, expression.getArguments());
  return { exception: named.name, ...(status === undefined ? {} : { status }) };
};

/**
 * Every exception a body throws and does not catch itself, in the order it is
 * written. A value thrown by name - a rethrow, an error built by a helper - is
 * left out: what it is was decided somewhere else.
 */
export const throwsIn = (body: Node): Thrown[] => {
  const found: Thrown[] = [];
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    if (caughtWithin(statement, body)) continue;
    const thrown = thrownBy(statement.getExpression());
    if (thrown !== undefined) found.push({ ...thrown, line: lineOf(statement) });
  }
  return found;
};
