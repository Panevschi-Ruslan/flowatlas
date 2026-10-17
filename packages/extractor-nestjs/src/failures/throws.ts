import { lineOf, soundsLikeAuthCheck } from '@flowatlas/core';
import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type ClassDeclaration,
  type ConstructorDeclaration,
  type Expression,
  type Identifier,
  type PropertyAccessExpression,
} from 'ts-morph';
import { functionNamedBy, memberFunctionCalled } from '../passes/called-function.js';
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

/** One exception a helper can give, and what its class answers with (P90). */
export interface Choice extends ClassAnswer {
  exception: string;
}

/** One `throw` written in a body. */
export interface Thrown extends ClassAnswer {
  /** The class thrown, or the helper that builds it (P90). */
  exception: string;
  line: number;
  /** What is thrown is what a helper returns (P90). */
  via?: 'helper';
  /** Every exception the helper can give, when its answer was read (P90). */
  choices?: Choice[];
  /** The throw refuses a request whose check is about who is asking, where the helper's answer could not be read (P90). */
  family?: 'auth';
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

/** How many helpers deep a thrown value is read: the one thrown, and one it calls (P90). */
export const MOST_HELPER_DEPTH = 2;

/** Most exceptions one helper is listed with (P90). */
export const MOST_CHOICES = 12;

/** How many names bound to names are followed to a table or a class. */
const MOST_BINDINGS = 4;

/** Looks through casts, brackets and an `await`. */
const unwrapped = (expression: Node): Node => {
  let at = bare(expression);
  while (Node.isAwaitExpression(at)) at = bare(at.getExpression());
  return at;
};

/** What a name is declared as, through an import to the declaration it names. */
const declaredAs = (identifier: Identifier): Node | undefined => {
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  const aliased = symbol.isAlias() ? symbol.getAliasedSymbol() : undefined;
  return aliased?.getDeclarations()[0] ?? symbol.getDeclarations()[0];
};

/** The value a `const` is bound to, when the name is one. */
const constValue = (declaration: Node | undefined): Node | undefined => {
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
  return declaration.getInitializer();
};

/** A helper a throw calls: a function or method of this service, and the name it is called by. */
interface Helper {
  name: string;
  body: Node;
}

/** `this.reject` → `reject`, `this.errors.toHttp` → `errors.toHttp`. */
const helperName = (callee: Node): string => callee.getText().replace(/^this\./, '').replace(/\s+/g, '');

/** A method of a class written here that an access names, read off the type of what it is called on. */
const methodOnType = (access: PropertyAccessExpression): Node | undefined => {
  const receiver = access.getExpression();
  const name = access.getName();
  const declarations = receiver.getType().getSymbol()?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (!Node.isClassDeclaration(declaration) || declaration.getSourceFile().isDeclarationFile()) continue;
    const method = declaration.getInstanceMethod(name) ?? declaration.getStaticMethod(name);
    const body = method?.getBody();
    if (body !== undefined) return body;
    const property = declaration.getInstanceProperty(name) ?? declaration.getStaticProperty(name);
    const value = property !== undefined && Node.isPropertyDeclaration(property) ? property.getInitializer() : undefined;
    if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return value.getBody();
  }
  return undefined;
};

/**
 * The function or method of this service a call names (P90): `f(x)`, `this.f(x)`,
 * `errors.f(x)` on an object of functions or a module, or a method of a class
 * written here, called on an instance of it.
 */
const helperCalled = (call: CallExpression): Helper | undefined => {
  const callee = bare(call.getExpression());
  if (Node.isIdentifier(callee)) {
    const fn = functionNamedBy(callee);
    return fn === undefined ? undefined : { name: helperName(callee), body: fn.body };
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const member = memberFunctionCalled(callee);
  if (member !== undefined) return { name: helperName(callee), body: member.body };
  const body = methodOnType(callee);
  return body === undefined ? undefined : { name: helperName(callee), body };
};

/** The values an object or `Map` written as a `const` holds, by the expression that names it. */
const tableOf = (expression: Node, hops = 0): Map<string | undefined, Node> | undefined => {
  const value = bare(expression);
  let written: Node | undefined;
  if (Node.isIdentifier(value)) written = constValue(declaredAs(value));
  else if (Node.isPropertyAccessExpression(value)) {
    // `this.denials`, `HttpErrors.TABLE`: a property written with its table.
    const declaration = value.getSymbol()?.getDeclarations()[0];
    written = declaration !== undefined && Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
  }
  if (written === undefined) return undefined;
  const table = bare(written);
  if (Node.isIdentifier(table) && hops < MOST_BINDINGS) return tableOf(table, hops + 1);
  if (Node.isObjectLiteralExpression(table)) {
    const values = new Map<string | undefined, Node>();
    for (const property of table.getProperties()) {
      // A spread, a shorthand or a method is a value this cannot list.
      if (!Node.isPropertyAssignment(property)) return undefined;
      const initializer = property.getInitializer();
      if (initializer === undefined) return undefined;
      values.set(property.getName().replace(/^['"`]|['"`]$/g, ''), initializer);
    }
    return values;
  }
  if (Node.isNewExpression(table) && table.getExpression().getText() === 'Map') {
    const [entries] = table.getArguments();
    const list = entries === undefined ? undefined : bare(entries);
    if (list === undefined || !Node.isArrayLiteralExpression(list)) return undefined;
    const values = new Map<string | undefined, Node>();
    for (const [index, element] of list.getElements().entries()) {
      const pair = bare(element);
      if (!Node.isArrayLiteralExpression(pair) || pair.getElements().length !== 2) return undefined;
      const [key, entry] = pair.getElements() as unknown as [Node, Node];
      values.set(Node.isStringLiteral(key) ? key.getLiteralValue() : `#${index}`, entry);
    }
    return values;
  }
  return undefined;
};

/**
 * The values a lookup in a table can give: `TABLE[key]`, `TABLE.key`,
 * `TABLE.get(key)`. A key written as a literal gives its one value; any other
 * key, every value the table holds.
 */
const lookedUp = (expression: Node): Node[] | undefined => {
  const value = bare(expression);
  const pick = (table: Map<string | undefined, Node> | undefined, key: Node | undefined): Node[] | undefined => {
    if (table === undefined) return undefined;
    const literal = key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) ? key.getLiteralValue() : undefined;
    if (literal === undefined) return [...table.values()];
    const found = table.get(literal);
    return found === undefined ? undefined : [found];
  };
  if (Node.isElementAccessExpression(value)) {
    const argument = value.getArgumentExpression();
    return pick(tableOf(value.getExpression()), argument === undefined ? undefined : bare(argument));
  }
  if (Node.isPropertyAccessExpression(value)) {
    const table = tableOf(value.getExpression());
    const found = table?.get(value.getName());
    return found === undefined ? undefined : [found];
  }
  if (Node.isCallExpression(value)) {
    const callee = bare(value.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'get') return undefined;
    const [key] = value.getArguments();
    return pick(tableOf(callee.getExpression()), key === undefined ? undefined : bare(key));
  }
  return undefined;
};

/** Both sides of `a ?? b`, `a || b` and `c ? a : b`: either can be the value. */
const eitherOf = (value: Node): Node[] | undefined => {
  if (Node.isConditionalExpression(value)) return [value.getWhenTrue(), value.getWhenFalse()];
  if (Node.isBinaryExpression(value)) {
    const operator = value.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) return [value.getLeft(), value.getRight()];
  }
  return undefined;
};

/** Every answer of a list, or nothing when one of them could not be read. */
const allOf = <T>(items: readonly Node[], read: (item: Node) => T[] | undefined): T[] | undefined => {
  const found: T[] = [];
  for (const item of items) {
    const one = read(item);
    if (one === undefined) return undefined;
    found.push(...one);
  }
  return found;
};

/**
 * The classes an expression in `new (...)` can stand for (P90): a class named
 * outright, a `const` bound to one, a lookup in a table of them, and either
 * side of a `??` that falls back to one. A class handed in as a parameter, or
 * anything built at run time, cannot be named.
 */
const classesOf = (expression: Node, hops = 0): NamedClass[] | undefined => {
  const value = bare(expression);
  if (hops > MOST_BINDINGS) return undefined;
  const either = eitherOf(value);
  if (either !== undefined) return allOf(either, (item) => classesOf(item, hops + 1));
  const values = lookedUp(value);
  if (values !== undefined) return allOf(values, (item) => classesOf(item, hops + 1));
  if (!Node.isIdentifier(value)) return undefined;
  const declaration = declaredAs(value);
  const bound = constValue(declaration);
  if (bound !== undefined) return classesOf(bound, hops + 1);
  if (declaration !== undefined && (Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration))) return undefined;
  const named = classNamed(value);
  return named.declaration !== undefined || named.module !== undefined || named.builtIn === true ? [named] : undefined;
};

/** The expressions a function's body hands back: each `return`, or the body of an arrow written as one. */
const returnedBy = (body: Node): Node[] | undefined => {
  if (!Node.isBlock(body)) return [body];
  const owner = body.getParent();
  const returned: Node[] = [];
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    if (statement.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at)) !== owner) continue;
    const expression = statement.getExpression();
    // A bare `return` hands back nothing a `throw` can be read as.
    if (expression === undefined) return undefined;
    returned.push(expression);
  }
  return returned.length === 0 ? undefined : returned;
};

/**
 * The exceptions an expression can be (P90): `new X(...)`, `new TABLE[key](...)`
 * and `new (TABLE.get(key) ?? Fallback)(...)`, a lookup in a table of
 * exceptions already built, either side of a ternary, a `const` bound to any
 * of those, and what another helper returns, one level down.
 */
const choicesOf = (expression: Node, depth: number, hops = 0): Choice[] | undefined => {
  const value = unwrapped(expression);
  if (hops > MOST_BINDINGS) return undefined;
  if (Node.isNewExpression(value)) {
    const classes = classesOf(value.getExpression());
    return classes?.map((named) => ({ exception: named.name, ...answerOfClass(named, value.getArguments()) }));
  }
  const either = eitherOf(value);
  if (either !== undefined) return allOf(either, (item) => choicesOf(item, depth, hops + 1));
  const values = lookedUp(value);
  if (values !== undefined) return allOf(values, (item) => choicesOf(item, depth, hops + 1));
  if (Node.isCallExpression(value)) {
    const helper = helperCalled(value);
    return helper === undefined || depth >= MOST_HELPER_DEPTH ? undefined : exceptionChoices(helper, depth + 1);
  }
  if (Node.isIdentifier(value)) {
    const bound = constValue(declaredAs(value));
    return bound === undefined ? undefined : choicesOf(bound, depth, hops + 1);
  }
  return undefined;
};

const choiceKey = (choice: Choice): string => `${choice.exception}\u0000${choice.status ?? ''}`;

/**
 * Every exception a helper can return (P90), each once, in the order its table
 * writes them; nothing when any of its answers cannot be read, since a list
 * with one missing would say the helper cannot give what it can.
 *
 * `depth` is the helper's own: 1 for the one thrown, 2 for one it calls, and
 * one that calls another again is not read (`MOST_HELPER_DEPTH`).
 */
export const exceptionChoices = (fn: { body: Node }, depth = 1): Choice[] | undefined => {
  const returned = returnedBy(fn.body);
  if (returned === undefined) return undefined;
  const found = allOf(returned, (expression) => choicesOf(expression, depth));
  if (found === undefined) return undefined;
  const byKey = new Map<string, Choice>();
  for (const choice of found) if (!byKey.has(choiceKey(choice))) byKey.set(choiceKey(choice), choice);
  return [...byKey.values()];
};

/** The words a call is named with: the function, what it is called on, and the type of that. */
const namesOfCall = (call: CallExpression): string[] => {
  const callee = bare(call.getExpression());
  if (Node.isIdentifier(callee)) return [callee.getText()];
  if (!Node.isPropertyAccessExpression(callee)) return [];
  const receiver = bare(callee.getExpression());
  const receiverName = Node.isPropertyAccessExpression(receiver) ? receiver.getName() : Node.isIdentifier(receiver) ? receiver.getText() : undefined;
  const typeName = receiver.getType().getSymbol()?.getName();
  return [callee.getName(), receiverName, typeName].filter((name): name is string => name !== undefined && name !== '__type');
};

/** The call whose answer a value is: the call itself, or a `const` bound to one. */
const callBehind = (expression: Node): CallExpression | undefined => {
  const value = unwrapped(expression);
  if (Node.isCallExpression(value)) return value;
  if (!Node.isIdentifier(value)) return undefined;
  const bound = constValue(declaredAs(value));
  const call = bound === undefined ? undefined : unwrapped(bound);
  return call !== undefined && Node.isCallExpression(call) ? call : undefined;
};

/**
 * Whether a test reads a property of the answer of a check of who is asking:
 * `!r.ok`, `r.denied`, `r.error`, `!(await this.auth.verify(req)).ok`, where
 * `r` is what a call named with `AUTH_CHECK_WORDS` returned.
 */
const testsAuthAnswer = (condition: Node): boolean =>
  [condition, ...condition.getDescendants()].some((node) => {
    if (!Node.isPropertyAccessExpression(node)) return false;
    const call = callBehind(node.getExpression());
    return call !== undefined && soundsLikeAuthCheck(...namesOfCall(call));
  });

/**
 * Whether a throw is the refusal of an auth-shaped check (P90): it sits under
 * an `if` of its own function that tests what such a check answered. Read from
 * the check, never from the route.
 */
const refusesAuth = (thrown: Node): boolean => {
  for (let at: Node | undefined = thrown; at !== undefined; at = at.getParent()) {
    if (Node.isFunctionLikeDeclaration(at)) return false;
    const parent = at.getParent();
    if (parent !== undefined && Node.isIfStatement(parent) && parent.getExpression() !== at && testsAuthAnswer(parent.getExpression())) {
      return true;
    }
  }
  return false;
};

/** One status, when every choice answers the same one. */
const choicesAgree = (choices: readonly Choice[]): Pick<ClassAnswer, 'status' | 'assumed'> => {
  const status = agreed(choices.map((choice) => choice.status));
  if (status === undefined) return {};
  return { status, ...(choices.every((choice) => choice.assumed === true) ? { assumed: true as const } : {}) };
};

/**
 * What `throw f(x)` throws (P90): what the helper `f` returns, read off its
 * answers. Where those cannot be read, the throw is still listed - as the
 * refusal of a check of who is asking when the test above it says so, and as
 * a failure with nothing more to it when the helper is one of this service's.
 * A call to something this cannot open, under no such test, says nothing.
 */
const thrownThrough = (call: CallExpression, statement: Node): Omit<Thrown, 'line'> | undefined => {
  const helper = helperCalled(call);
  const choices = helper === undefined ? undefined : exceptionChoices(helper);
  const auth = choices === undefined && refusesAuth(statement);
  if (helper === undefined && !auth) return undefined;
  return {
    exception: helper?.name ?? helperName(bare(call.getExpression())),
    via: 'helper',
    ...(choices === undefined ? {} : { choices: choices.slice(0, MOST_CHOICES), ...(choices.length > MOST_CHOICES ? {} : choicesAgree(choices)) }),
    ...(auth ? { family: 'auth' as const } : {}),
    lineage: [],
  };
};

/**
 * What a `throw` throws: `new X(...)` as the class answers it; a helper's
 * answer, `throw f(x)`, `throw await f(x)` or `throw e` with `e` a `const`
 * bound to such a call (P90). Nothing for a rethrow or a value built
 * elsewhere.
 */
const thrownBy = (expression: Expression | undefined, statement: Node): Omit<Thrown, 'line'> | undefined => {
  if (expression === undefined) return undefined;
  if (Node.isNewExpression(expression)) {
    const callee = expression.getExpression();
    if (!Node.isIdentifier(callee)) return undefined;
    const named = classNamed(callee);
    return { exception: named.name, ...answerOfClass(named, expression.getArguments()) };
  }
  const call = callBehind(expression);
  if (call === undefined) return undefined;
  // `throw Error('x')` builds the language's own error without `new`; it was
  // never read as a helper and is not one.
  const callee = bare(call.getExpression());
  if (Node.isIdentifier(callee) && classNamed(callee).builtIn === true) return undefined;
  return thrownThrough(call, statement);
};

/**
 * Every exception a body throws and does not catch itself, in the order it is
 * written. A value thrown by name that no helper built - a rethrow, a caught
 * error - is left out: what it is was decided somewhere else.
 */
export const throwsIn = (body: Node): Thrown[] => {
  const found: Thrown[] = [];
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    if (caughtWithin(statement, body)) continue;
    const thrown = thrownBy(statement.getExpression(), statement);
    if (thrown !== undefined) found.push({ ...thrown, line: lineOf(statement) });
  }
  return found;
};
