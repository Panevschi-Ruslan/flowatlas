import type { ClassDeclaration, MethodDeclaration, Node as TsNode } from 'ts-morph';
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
 * Finds a method on a class or anything it inherits from.
 *
 * Returns the base class's package when the method comes from one instead, so
 * the caller can count it as a leaf rather than report it as a failure.
 */
export const findMethod = (
  declaration: ClassDeclaration,
  name: string,
): { method?: MethodDeclaration; externalPackage?: string } => {
  let current: ClassDeclaration | undefined = declaration;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    const method = current.getMethod(name);
    if (method !== undefined) {
      const pkg = packageOfFile(method.getSourceFile().getFilePath());
      return pkg === undefined ? { method } : { externalPackage: pkg };
    }
    current = current.getBaseClass();
  }
  return {};
};

/** A call this repository declares both ends of. */
export interface MemberCall {
  readonly classDecl: ClassDeclaration;
  readonly methodName: string;
  readonly methodDecl: MethodDeclaration;
}

/**
 * Resolves `this.<prop>.<m>()` and `this.<m>()` to the method they reach.
 *
 * Null covers everything that is not one class of this repository calling
 * another: a receiver nothing pins down, a method that does not exist, a method
 * inherited from a package. Callers that need to tell those apart use
 * {@link resolveReceiver} and {@link findMethod} directly.
 */
export const resolveMemberCall = (
  call: TsNode,
  owner: ClassDeclaration,
  di: DiMap,
): MemberCall | null => {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const receiver = resolveReceiver(callee.getExpression(), owner, di);
  if (receiver.classDecl === undefined) return null;
  const methodName = callee.getName();
  const found = findMethod(receiver.classDecl, methodName);
  if (found.method === undefined) return null;
  return { classDecl: receiver.classDecl, methodName, methodDecl: found.method };
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
  body.forEachDescendant((node, traversal) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (Node.isCallExpression(node)) visit(node);
  });
};
