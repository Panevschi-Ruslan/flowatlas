import { Node, SyntaxKind, type ClassDeclaration, type Expression, type Type } from 'ts-morph';
import { GUARD_REFUSAL, knownRefusal, type Refusal } from './statuses.js';
import { classNamed } from './throws.js';

/*
 * Whether a guard written here can say no (P87).
 *
 * The framework answers a guard's `false` with a 403. A guard whose
 * `canActivate` returns `true` on every path, and otherwise throws, never
 * gives it the chance: what it refuses with is what it throws, which the body
 * reader already lists. Giving such a guard a 403 as well put a status on most
 * routes that no request can get.
 */

/** How many classes up a chain of `extends` a `canActivate` is looked for. */
const MAX_BASES = 8;

/** Types a guard's answer arrives wrapped in. */
const WRAPPERS: ReadonlySet<string> = new Set(['Promise', 'Observable']);

/** The value inside a `Promise<T>` or an `Observable<T>`. */
const unwrapped = (type: Type): Type => {
  let at = type;
  for (let depth = 0; depth < 3; depth += 1) {
    const name = at.getSymbol()?.getName();
    const [inner] = at.getTypeArguments();
    if (name === undefined || !WRAPPERS.has(name) || inner === undefined) return at;
    at = inner;
  }
  return at;
};

/** Only `true` can come out of it: the literal type, or a union of nothing else. */
const onlyTrue = (type: Type): boolean => {
  const value = unwrapped(type);
  if (value.isUnion()) return value.getUnionTypes().every((member) => member.isBooleanLiteral() && member.getText() === 'true');
  return value.isBooleanLiteral() && value.getText() === 'true';
};

const isSuperCanActivate = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === 'canActivate' &&
    callee.getExpression().getKind() === SyntaxKind.SuperKeyword
  );
};

const bare = (expression: Expression): Expression => {
  let at: Expression = expression;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isAwaitExpression(at) || Node.isNonNullExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

/** Whether control cannot run past a statement: it returns or throws on every path. */
const ends = (statement: Node | undefined): boolean => {
  if (statement === undefined) return false;
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) return ends(statement.getStatements().at(-1));
  if (Node.isIfStatement(statement)) return ends(statement.getThenStatement()) && ends(statement.getElseStatement());
  if (Node.isTryStatement(statement)) {
    const handler = statement.getCatchClause();
    return ends(statement.getTryBlock()) && (handler === undefined || ends(handler.getBlock()));
  }
  return false;
};

const distinct = (refusals: readonly Refusal[]): Refusal[] => {
  const seen = new Map<string, Refusal>();
  for (const refusal of refusals) seen.set(`${refusal.status}\u0000${refusal.exception}`, refusal);
  return [...seen.values()];
};

/** What a guard's base refuses with, when its `canActivate` is the base's. */
const inheritedRefusals = (declaration: ClassDeclaration, depth: number): Refusal[] => {
  const written = declaration.getExtends()?.getExpression();
  // `extends AuthGuard('jwt')` names the factory; the class it builds is the
  // factory's, and its refusal is the one the table knows for it.
  const named = written === undefined ? undefined : Node.isCallExpression(written) ? written.getExpression() : written;
  if (named === undefined || !Node.isIdentifier(named)) return [GUARD_REFUSAL];
  const base = classNamed(named);
  if (base.declaration !== undefined && depth < MAX_BASES) return refusalsOf(base.declaration, depth + 1);
  return [knownRefusal(base.module, base.name) ?? GUARD_REFUSAL];
};

const refusalsOf = (declaration: ClassDeclaration, depth: number): Refusal[] => {
  const method = declaration.getInstanceMethod('canActivate');
  if (method === undefined) return inheritedRefusals(declaration, depth);
  const body = method.getBody();
  // An overload or an abstract method: nothing to read, so it can refuse.
  if (body === undefined || !Node.isBlock(body)) return [GUARD_REFUSAL];

  const found: Refusal[] = [];
  if (body.getDescendants().some(isSuperCanActivate)) found.push(...inheritedRefusals(declaration, depth));
  const returns = body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at)) === method);
  for (const statement of returns) {
    const written = statement.getExpression();
    // `return;` answers undefined, which the framework reads as no.
    if (written === undefined) {
      found.push(GUARD_REFUSAL);
      continue;
    }
    const value = bare(written);
    if (value.getKind() === SyntaxKind.TrueKeyword) continue;
    if (isSuperCanActivate(value)) continue;
    if (value.getKind() === SyntaxKind.FalseKeyword || !onlyTrue(value.getType())) found.push(GUARD_REFUSAL);
  }
  // Falling off the end answers undefined too.
  if (!ends(body)) found.push(GUARD_REFUSAL);
  return distinct(found);
};

/**
 * What a guard written here refuses with on its own account: the framework's
 * 403 where its `canActivate` can answer anything but `true`, the refusal of
 * the installed guard it extends where it hands over to it, and nothing where
 * every answer is `true`. A body that cannot be read can refuse.
 */
export const guardRefusals = (declaration: ClassDeclaration): Refusal[] => refusalsOf(declaration, 0);

/** Whether a guard written here can answer a request with no (P87). */
export const canRefuse = (declaration: ClassDeclaration): boolean => guardRefusals(declaration).length > 0;
