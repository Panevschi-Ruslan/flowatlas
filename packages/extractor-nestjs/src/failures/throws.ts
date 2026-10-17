import { lineOf } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type ConstructorDeclaration, type Expression, type Identifier } from 'ts-morph';
import {
  EXCEPTION_STATUS,
  HTTP_EXCEPTION,
  HTTP_STATUS,
  STATUSLESS_EXCEPTIONS,
  UNKNOWN_ERROR_STATUS,
} from './statuses.js';

/**
 * What a thrown class answers with, before anything in front of the route has
 * had its say (P87).
 *
 * `status` is what the caller gets when no filter maps it; `own` is what the
 * exception carries itself, which a filter reading `exception.status` answers
 * with instead. They differ for a project's own error class: it says 404, and
 * with nothing to read that, the framework answers 500.
 */
export interface ClassAnswer {
  status?: number;
  /** The status is the framework's default, written nowhere on the path. */
  assumed?: true;
  /** The class's own status, where the caller gets `status` instead. */
  declared?: number;
  /** The status the exception carries, for a filter that reads it. */
  own?: number;
  /** The class and every class it extends, nearest first: what `@Catch(...)` is matched against. */
  lineage: string[];
}

/** One `throw` written in a body. */
export interface Thrown extends ClassAnswer {
  exception: string;
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

/** Looks through the casts and brackets a value is written behind. */
const bare = (expression: Node): Node => {
  let at = expression;
  while (Node.isAsExpression(at) || Node.isParenthesizedExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

/** A status written as a number, as a member of `HttpStatus`, or as a constant holding one. */
export const statusWritten = (expression: Node | undefined, depth = 0): number | undefined => {
  if (expression === undefined) return undefined;
  const value = bare(expression);
  if (Node.isNumericLiteral(value)) return Number(value.getLiteralValue());
  if (Node.isPropertyAccessExpression(value)) return HTTP_STATUS.get(value.getName());
  if (Node.isIdentifier(value) && depth < 2) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const') {
      return statusWritten(declaration.getInitializer(), depth + 1);
    }
  }
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

/** The position of a constructor parameter a name stands for, if it stands for one. */
const parameterIndex = (constructor: ConstructorDeclaration, name: Node): number | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const declaration = name.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isParameterDeclaration(declaration)) return undefined;
  const index = constructor.getParameters().indexOf(declaration);
  return index < 0 ? undefined : index;
};

/**
 * What a class hands its base, built with these arguments.
 *
 * `super(message, status)` where `status` is the constructor's own parameter
 * hands on what the class was built with, so `new AppError('x', 404)` reaches
 * the base with 404. A class with no constructor hands on its arguments as
 * they are.
 */
const handedOn = (declaration: ClassDeclaration, args: readonly Node[]): readonly Node[] => {
  const handed = superArguments(declaration);
  const [constructor] = declaration.getConstructors();
  if (handed === undefined || constructor === undefined) return handed ?? args;
  return handed.map((argument) => {
    const index = parameterIndex(constructor, bare(argument));
    return index === undefined ? argument : (args[index] ?? argument);
  });
};

/** The names a class keeps its status under. */
const STATUS_NAMES: ReadonlySet<string> = new Set(['status', 'statusCode']);

/** One status, when every value given says the same one. */
const agreed = (values: ReadonlyArray<number | undefined>): number | undefined => {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
};

/** `readonly status = 404`, `statusCode = HttpStatus.NOT_FOUND`. */
const propertyStatus = (declaration: ClassDeclaration): number | undefined => {
  for (const property of declaration.getProperties()) {
    if (property.isStatic() || !STATUS_NAMES.has(property.getName())) continue;
    const status = statusWritten(property.getInitializer());
    if (status !== undefined) return status;
  }
  return undefined;
};

/** `get status() { return 423; }`, `getStatus() { return 409; }`: every answer the same status. */
const getterStatus = (declaration: ClassDeclaration): number | undefined => {
  const bodies = [
    ...declaration.getGetAccessors().filter((getter) => !getter.isStatic() && STATUS_NAMES.has(getter.getName())),
    ...declaration.getMethods().filter((method) => !method.isStatic() && method.getName() === 'getStatus'),
  ].map((member) => member.getBody());
  for (const body of bodies) {
    if (body === undefined) continue;
    const returns = body
      .getDescendantsOfKind(SyntaxKind.ReturnStatement)
      .filter((statement) => statement.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at)) === body.getParent());
    const status = agreed(returns.map((statement) => statusWritten(statement.getExpression())));
    if (status !== undefined) return status;
  }
  return undefined;
};

/**
 * What the constructor stores as the status: a parameter property named
 * `status`, `this.status = status` from a parameter, or `this.status = 404`.
 */
const storedStatus = (declaration: ClassDeclaration, args: readonly Node[]): number | undefined => {
  const [constructor] = declaration.getConstructors();
  if (constructor === undefined) return undefined;
  for (const [index, parameter] of constructor.getParameters().entries()) {
    if (parameter.isParameterProperty() && STATUS_NAMES.has(parameter.getName())) {
      const status = statusWritten(args[index]) ?? statusWritten(parameter.getInitializer());
      if (status !== undefined) return status;
    }
  }
  for (const assignment of constructor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const target = assignment.getLeft();
    if (!Node.isPropertyAccessExpression(target) || target.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;
    if (!STATUS_NAMES.has(target.getName())) continue;
    const value = bare(assignment.getRight());
    const index = parameterIndex(constructor, value);
    const status = index === undefined ? statusWritten(value) : statusWritten(args[index]);
    if (status !== undefined) return status;
  }
  return undefined;
};

/**
 * The status a class of this project states for itself, on it or on a class
 * it extends, the nearest first (P87): a property, a getter, or what its
 * constructor stores from the arguments it is built with.
 */
export const statusDeclaredBy = (named: NamedClass, args: readonly Node[] = []): number | undefined => {
  let current = named;
  let given = args;
  for (let depth = 0; depth <= MAX_BASES; depth += 1) {
    const declaration = current.declaration;
    if (declaration === undefined) return undefined;
    const own = propertyStatus(declaration) ?? getterStatus(declaration) ?? storedStatus(declaration, given);
    if (own !== undefined) return own;
    const base = declaration.getExtends()?.getExpression();
    if (base === undefined || !Node.isIdentifier(base)) return undefined;
    given = handedOn(declaration, given);
    current = classNamed(base);
  }
  return undefined;
};

/** The language's own base of every error. */
const ERROR = 'Error';

/** What the framework answers a class that is not one of its own, and what the class says it is. */
const unmapped = (lineage: string[], declared: number | undefined): ClassAnswer => ({
  status: UNKNOWN_ERROR_STATUS,
  assumed: true,
  ...(declared === undefined || declared === UNKNOWN_ERROR_STATUS ? {} : { declared }),
  ...(declared === undefined ? {} : { own: declared }),
  lineage,
});

/**
 * What an exception class answers with, built with these arguments.
 *
 * A class of the framework's is a row of the table. One written here is read
 * through its `extends` to the first class that is not, handing on what its
 * constructor passes to `super`. One that reaches an exception of the
 * framework's answers that exception's status; one that reaches the language's
 * `Error`, or nothing that can be named, is what the framework answers an
 * unknown error with - assumed, with the status the class declares for itself
 * kept beside it for a filter that reads it.
 */
export const answerOfClass = (named: NamedClass, args: readonly Node[]): ClassAnswer => {
  const lineage: string[] = [];
  let current = named;
  let given = args;
  for (let depth = 0; ; depth += 1) {
    lineage.push(current.name);
    if (current.declaration === undefined) break;
    const base = current.declaration.getExtends()?.getExpression();
    if (base === undefined || !Node.isIdentifier(base) || depth >= MAX_BASES) {
      return unmapped(lineage, statusDeclaredBy(named, args));
    }
    given = handedOn(current.declaration, given);
    current = classNamed(base);
  }

  const top = current.name;
  if (top === HTTP_EXCEPTION) {
    const status = statusWritten(given[1]);
    return { ...(status === undefined ? {} : { status, own: status }), lineage: [...lineage, ERROR] };
  }
  const known = EXCEPTION_STATUS.get(top);
  if (known !== undefined) return { status: known, own: known, lineage: [...lineage, HTTP_EXCEPTION, ERROR] };
  if (STATUSLESS_EXCEPTIONS.has(top)) return { lineage: [...lineage, ERROR] };
  const declared = statusDeclaredBy(named, args);
  if (current.builtIn === true || current.module === undefined) {
    return unmapped(top === ERROR || current.builtIn !== true ? lineage : [...lineage, ERROR], declared);
  }
  // A class of an installed package nothing here can read may be one of the
  // framework's under another name; a guess would be worse than nothing.
  return { ...(declared === undefined ? {} : { own: declared, declared }), lineage };
};

/** The status an exception class answers with when nothing in front of the route maps it. */
export const statusOfClass = (named: NamedClass, args: readonly Node[]): number | undefined =>
  answerOfClass(named, args).status;

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
  return { exception: named.name, ...answerOfClass(named, expression.getArguments()) };
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
