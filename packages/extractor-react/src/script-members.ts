import { startLineOf, type NamedFunction } from '@flowatlas/core';
import type { Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The functions a plain script writes as members (P310).
 *
 * Plain browser code keeps its functions where no module function is: as the
 * methods of an object written in place (`const api = { load() { ... } }`,
 * `export default { fetchUsers() { ... } }`) and as the members of a
 * constructor's prototype (`Store.prototype.load = function () { ... }`,
 * `Store.prototype = { load() {} }`, `Object.assign(Store.prototype, { load()
 * {} })`). Each is a function another script calls by its member's name -
 * `api.load()`, `store.load()` on a `new Store()` - and a request written in
 * one is the page's as much as one written in a declared function. So each is
 * a function of its own, named by where it is kept: `api.load`,
 * `api.users.list` for an object inside the object, `default.fetchUsers` for a
 * module's default, `Store.load` for a prototype's.
 *
 * Only what the top of a script writes, as for module functions: a member of
 * an object built inside a function is reachable only through that function.
 */

/** One member function, with what else the checker may hand back for it and whose instances have it. */
export interface ScriptMember {
  readonly fn: NamedFunction;
  /** The declarations of the constructor whose instances have it, for a prototype's member. */
  readonly owners: readonly TsNode[];
  /** Other nodes the checker hands back for it: the `Store.prototype.load` an assignment writes. */
  readonly also: readonly TsNode[];
}

/** How deep objects inside an object are read for members. */
const DEPTH = 3;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isSatisfiesExpression(current)) current = current.getExpression();
  return current;
};

/** A member's name as written: an identifier or a string; none for a computed one. */
const memberName = (node: TsNode): string | undefined => {
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return undefined;
};

/** The functions an object written in place holds, each named under `prefix`, and those of the objects inside it. */
const objectMembers = (object: ObjectLiteralExpression, prefix: string, owners: readonly TsNode[], depth = 0): ScriptMember[] => {
  const found: ScriptMember[] = [];
  for (const property of object.getProperties()) {
    if (Node.isMethodDeclaration(property)) {
      const name = memberName(property.getNameNode());
      const body = property.getBody();
      if (name === undefined || body === undefined) continue;
      found.push({ fn: { name: `${prefix}.${name}`, declaration: property, body, line: startLineOf(property) }, owners, also: [] });
      continue;
    }
    if (!Node.isPropertyAssignment(property)) continue;
    const name = memberName(property.getNameNode());
    const written = property.getInitializer();
    if (name === undefined || written === undefined) continue;
    const value = unwrap(written);
    if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
      found.push({ fn: { name: `${prefix}.${name}`, declaration: property, body: value.getBody(), line: startLineOf(property) }, owners, also: [] });
    } else if (Node.isObjectLiteralExpression(value) && depth < DEPTH) {
      // An object inside a prototype's object is no member of the instances.
      found.push(...objectMembers(value, `${prefix}.${name}`, [], depth + 1));
    }
  }
  return found;
};

/** The declarations a constructor's name stands for. */
const declarationsOf = (name: TsNode): TsNode[] => {
  const symbol = name.getSymbol();
  return symbol === undefined ? [] : [...(symbol.getAliasedSymbol() ?? symbol).getDeclarations()];
};

/** `C` of `C.prototype`, where an expression is one. */
const prototypeOf = (node: TsNode): TsNode | undefined => {
  const target = unwrap(node);
  if (!Node.isPropertyAccessExpression(target) || target.getName() !== 'prototype') return undefined;
  const owner = unwrap(target.getExpression());
  return Node.isIdentifier(owner) ? owner : undefined;
};

/** The members a top-level `C.prototype.m = function`, `C.prototype = { … }` or `Object.assign(C.prototype, { … })` writes. */
const prototypeMembers = (statement: TsNode): ScriptMember[] => {
  if (!Node.isExpressionStatement(statement)) return [];
  const expression = unwrap(statement.getExpression());
  if (Node.isBinaryExpression(expression) && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    const left = unwrap(expression.getLeft());
    const right = unwrap(expression.getRight());
    const whole = prototypeOf(left);
    if (whole !== undefined && Node.isObjectLiteralExpression(right)) return objectMembers(right, whole.getText(), declarationsOf(whole));
    if (!Node.isPropertyAccessExpression(left) || (!Node.isArrowFunction(right) && !Node.isFunctionExpression(right))) return [];
    const owner = prototypeOf(left.getExpression());
    if (owner === undefined) return [];
    const fn: NamedFunction = { name: `${owner.getText()}.${left.getName()}`, declaration: right, body: right.getBody(), line: startLineOf(statement) };
    return [{ fn, owners: declarationsOf(owner), also: [left] }];
  }
  if (Node.isCallExpression(expression) && expression.getExpression().getText() === 'Object.assign') {
    const [target, ...sources] = expression.getArguments();
    const owner = target === undefined ? undefined : prototypeOf(target);
    if (owner === undefined) return [];
    return sources.flatMap((source) => {
      const object = unwrap(source);
      return Node.isObjectLiteralExpression(object) ? objectMembers(object, owner.getText(), declarationsOf(owner)) : [];
    });
  }
  return [];
};

/** Every member function the top of a script writes. */
export const scriptMembers = (sourceFile: SourceFile): ScriptMember[] => {
  const found: ScriptMember[] = [];
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    const written = declaration.getInitializer();
    if (!Node.isIdentifier(name) || written === undefined) continue;
    const value = unwrap(written);
    if (Node.isObjectLiteralExpression(value)) found.push(...objectMembers(value, name.getText(), []));
  }
  for (const statement of sourceFile.getStatements()) {
    if (Node.isExportAssignment(statement) && !statement.isExportEquals()) {
      const value = unwrap(statement.getExpression());
      if (Node.isObjectLiteralExpression(value)) found.push(...objectMembers(value, 'default', []));
      continue;
    }
    found.push(...prototypeMembers(statement));
  }
  return found;
};
