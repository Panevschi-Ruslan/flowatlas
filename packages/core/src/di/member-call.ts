import type {
  ArrowFunction,
  ClassDeclaration,
  FunctionExpression,
  MethodDeclaration,
  ParameterDeclaration,
  PropertyDeclaration,
  Node as TsNode,
} from 'ts-morph';
import { Node } from 'ts-morph';
import { packageOfFile } from '../nodes.js';
import { originOfType } from '../origin.js';
import type { DiMap } from './types.js';

/** What the thing before the dot turned out to be. */
export interface ReceiverInfo {
  readonly kind: 'this' | 'super' | 'this-prop' | 'local' | 'builtin' | 'dynamic';
  /** Class declared in this repository. */
  readonly classDecl?: ClassDeclaration;
  /** Class or interface declared in an installed package. */
  readonly external?: { readonly package: string; readonly typeName: string };
  /** Property name, when the receiver was reached through `this`. */
  readonly property?: string;
  /** Set when the receiver is a container-provided value that cannot be followed. */
  readonly token?: string;
  /**
   * The injection this receiver comes from was already reported at the
   * constructor, so its call sites say nothing new.
   */
  readonly diUnresolved?: boolean;
  readonly text: string;
}

const fromOrigin = (
  node: TsNode,
  kind: 'local' | 'this-prop',
  property?: string,
): ReceiverInfo => {
  const text = node.getText();
  const origin = originOfType(node);
  const base = property === undefined ? { text } : { property, text };
  if (origin.kind === 'local' && Node.isClassDeclaration(origin.declaration)) {
    return { kind, classDecl: origin.declaration, ...base };
  }
  if (origin.kind === 'external') {
    return { kind, external: { package: origin.package, typeName: origin.typeName }, ...base };
  }
  if (origin.kind === 'builtin') return { kind: 'builtin', ...base };
  return { kind: 'dynamic', ...base };
};

/**
 * Follows the receiver of a call back to the class that declares it.
 *
 * The property injected into a class is the common case, and the injection map
 * answers it exactly. Everything else goes through the checker, and anything the
 * checker will not commit to comes back dynamic rather than guessed by name: a
 * `calls` edge claims the compiler agrees, so a name-based match here would make
 * that claim false.
 *
 * `owner` is the class the call is written in, and is absent when the call is in
 * a function that belongs to no class. `this` means nothing there, so the three
 * forms that go through it stop rather than resolve; a receiver named in the
 * ordinary way still resolves by its declared type, which is what makes a
 * dependency destructured out of an argument reach the class behind it.
 */
export const resolveReceiver = (
  expr: TsNode,
  owner: ClassDeclaration | undefined,
  di: DiMap,
): ReceiverInfo => {
  const text = expr.getText();

  if (Node.isThisExpression(expr)) {
    return owner === undefined ? { kind: 'dynamic', text } : { kind: 'this', classDecl: owner, text };
  }
  if (Node.isSuperExpression(expr)) {
    const base = owner?.getBaseClass();
    return base === undefined ? { kind: 'dynamic', text } : { kind: 'super', classDecl: base, text };
  }

  if (
    owner !== undefined &&
    Node.isPropertyAccessExpression(expr) &&
    Node.isThisExpression(expr.getExpression())
  ) {
    const property = expr.getName();
    const entry = di.lookup(owner, property);
    if (entry !== undefined) {
      const { resolution } = entry;
      if (resolution.kind === 'class') {
        return { kind: 'this-prop', classDecl: resolution.declaration, property, text };
      }
      if (resolution.kind === 'external') {
        return {
          kind: 'this-prop',
          external: { package: resolution.package, typeName: resolution.typeName },
          property,
          text,
        };
      }
      if (resolution.kind === 'token') {
        return { kind: 'this-prop', property, token: resolution.token, text };
      }
      return { kind: 'dynamic', property, text, diUnresolved: true };
    }
    return fromOrigin(expr, 'this-prop', property);
  }

  if (Node.isElementAccessExpression(expr)) return { kind: 'dynamic', text };

  return fromOrigin(expr, 'local');
};

/**
 * A method of a class, however it was written.
 *
 * `handle() {}` and `handle = () => {}` are the same thing to everything that
 * matters here: a name on a class, a body, and calls inside it. The second is
 * how a method that will be handed to a callback keeps its `this`, which is why
 * bots and components are full of them. Reading only the first reports a call
 * on the second as a receiver nobody can pin down, which is true of no part of
 * it (R25).
 */
export type ClassMethod = MethodDeclaration | PropertyDeclaration;

/** The function a property holds, when it holds one written in place. */
const fieldFunction = (
  property: PropertyDeclaration,
): ArrowFunction | FunctionExpression | undefined => {
  const initializer = property.getInitializer();
  if (initializer === undefined) return undefined;
  return Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
    ? initializer
    : undefined;
};

/**
 * The function a method is, whichever way it was written.
 *
 * Everything else here is a question about that function — its parameters, its
 * body, whether there is one at all — so the branch is written once.
 */
export const functionOf = (
  declaration: ClassMethod,
): MethodDeclaration | ArrowFunction | FunctionExpression | undefined =>
  Node.isMethodDeclaration(declaration) ? declaration : fieldFunction(declaration);

/**
 * The parameters of a method, wherever they were written.
 *
 * A method written as a field keeps them on the arrow it holds, which is one
 * node further in than every caller expects to look.
 */
export const parametersOf = (declaration: ClassMethod): ParameterDeclaration[] =>
  functionOf(declaration)?.getParameters() ?? [];

/** The body of a method, wherever it was written. */
export const bodyOf = (declaration: ClassMethod): TsNode | undefined =>
  functionOf(declaration)?.getBody();

/**
 * The method a node is written in, however that method was written.
 *
 * The nearest of the two, not the first of one kind: a class expression inside
 * a method would otherwise answer for a field-method written in it.
 */
export const enclosingMethod = (node: TsNode): ClassMethod | undefined => {
  for (let at: TsNode | undefined = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isMethodDeclaration(at)) return at;
    if (Node.isPropertyDeclaration(at)) return fieldFunction(at) === undefined ? undefined : at;
    if (Node.isClassDeclaration(at)) return undefined;
  }
  return undefined;
};

/**
 * Every method a class declares, including the ones written as fields.
 *
 * Declarations, not bodies: an abstract method and an overload signature are
 * methods a caller can name and an annotation can sit on, so whatever answers
 * "what are this class's methods" has to include them. A walk that reads
 * bodies asks {@link methodBodies} instead.
 */
export const methodsOfClass = (declaration: ClassDeclaration): ClassMethod[] => [
  ...declaration.getMethods(),
  ...declaration.getProperties().filter((property) => fieldFunction(property) !== undefined),
];

/**
 * The method of that name on one class, written either way.
 *
 * One step, not a search: the caller decides whether to walk what the class
 * extends. {@link findMethod} does; a trace standing in a known class does not.
 */
export const methodNamedOn = (
  owner: ClassDeclaration,
  name: string,
): ClassMethod | undefined => {
  const method = owner.getMethod(name);
  if (method !== undefined) return method;
  const property = owner.getProperty(name);
  return property !== undefined && fieldFunction(property) !== undefined ? property : undefined;
};

/**
 * Every method a class declares that has a body, including the ones written as
 * fields, each with the body to read.
 *
 * One accessor rather than a list and a lookup: a field holding a value is not
 * a method, an abstract method and an overload signature have no body, and
 * every caller wants the same two things about the ones that are left.
 */
export const methodBodies = (
  declaration: ClassDeclaration,
): Array<{ declaration: ClassMethod; body: TsNode }> =>
  methodsOfClass(declaration)
    .map((method) => ({ declaration: method, body: bodyOf(method) }))
    .filter((found): found is { declaration: ClassMethod; body: TsNode } => found.body !== undefined);

/**
 * Finds a method on a class or anything it inherits from.
 *
 * Returns the base class's package when the method comes from one instead, so
 * the caller can count it as a leaf rather than report it as a failure.
 */
export const findMethod = (
  declaration: ClassDeclaration,
  name: string,
): { method?: ClassMethod; externalPackage?: string } => {
  let current: ClassDeclaration | undefined = declaration;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    const method = methodNamedOn(current, name);
    if (method !== undefined) {
      const pkg = packageOfFile(method.getSourceFile().getFilePath());
      return pkg === undefined ? { method } : { externalPackage: pkg };
    }
    current = current.getBaseClass();
  }
  return {};
};

/**
 * Every call site inside a method body, without descending into a nested class.
 *
 * Calls written inside a callback still belong to the method that contains them;
 * calls inside a class declared in the body belong to that class instead.
 */
export const forEachCall = (
  body: TsNode,
  visit: (call: TsNode & { getExpression(): TsNode }) => void,
): void => {
  // An arrow with no braces — `(deps) => deps.orders.find(id)` — is a body that
  // *is* the call, and a walk of its descendants alone would miss the only call
  // in it. Every other body is a block, where this is never true.
  if (Node.isCallExpression(body)) visit(body);
  body.forEachDescendant((node, traversal) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (Node.isCallExpression(node)) visit(node);
  });
};
