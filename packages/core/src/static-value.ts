import type { Node as TsNode } from 'ts-morph';
import { VariableDeclarationKind, Node, SyntaxKind } from 'ts-morph';

/**
 * The result of trying to read a value out of the source without running it.
 *
 * An unresolved value is never turned into a guess: the caller records it and
 * degrades, because a route path or a channel name invented here would become a
 * confident edge that is simply wrong.
 */
export type StaticValue =
  | { readonly resolved: true; readonly value: unknown }
  | { readonly resolved: false; readonly text: string; readonly reason: string };

export const resolvedValue = (value: unknown): StaticValue => ({ resolved: true, value });

export const unresolvedValue = (text: string, reason = 'not-a-static-value'): StaticValue => ({
  resolved: false,
  text,
  reason,
});

const MAX_DEPTH = 8;

/**
 * The reasons that mean a name holds a value decided at run time.
 *
 * Every other unresolved name is a constant this could not read — declared
 * without a value, or written with one no walk can settle — and those are two
 * different things to tell a reader: one can be fixed by moving the constant
 * somewhere it can be followed, the other by nothing short of annotating the
 * call. One list, so every reader asking the question gets one answer (R140).
 */
const RUN_TIME_REASONS = {
  /** A `let` or `var`: whatever was last assigned. */
  reassignable: 'reassignable-binding',
  /** A parameter: whatever each caller hands it. */
  parameter: 'parameter',
} as const;

const RUN_TIME = new Set<string>(Object.values(RUN_TIME_REASONS));

/** Whether an unread value is a name bound at run time, rather than a constant nobody could read. */
export const isRunTimeValue = (value: StaticValue): boolean =>
  !value.resolved && RUN_TIME.has(value.reason);

const unwrap = (expr: TsNode): TsNode => {
  let current = expr;
  for (;;) {
    if (Node.isParenthesizedExpression(current) || Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
};

/**
 * The node the checker answers for when asked what an expression names.
 *
 * A member written in brackets with its name spelled out, `operations['archive']`,
 * is the member `operations.archive` is, and the checker answers for the key
 * inside the brackets. A key that is not written out names no member.
 */
const nameIn = (node: TsNode): TsNode | undefined => {
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) return node;
  if (!Node.isElementAccessExpression(node)) return undefined;
  const key = node.getArgumentExpression();
  return key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) ? key : undefined;
};

/**
 * The declaration an identifier or a member access names, following imports,
 * and re-exports with them - `export { x } from` and `export *` (R168).
 */
export const declarationOf = (node: TsNode): TsNode | undefined => {
  const symbol = nameIn(node)?.getSymbol();
  if (symbol === undefined) return undefined;
  const aliased = symbol.getAliasedSymbol();
  return (aliased ?? symbol).getDeclarations()[0];
};

/**
 * Reads a compile-time constant out of an expression.
 *
 * Two routes to an answer: the type checker, which already knows the value of
 * anything with a literal type (a string enum member, a `const` binding), and a
 * structural walk for the rest (array and object literals, a property of a
 * constant object). Whatever neither can settle comes back unresolved.
 */
export const evaluateExpression = (expr: TsNode, depth = 0): StaticValue => {
  if (depth > MAX_DEPTH) return unresolvedValue(expr.getText(), 'nesting-too-deep');
  const node = unwrap(expr);

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return resolvedValue(node.getLiteralValue());
  }
  if (Node.isNumericLiteral(node)) return resolvedValue(node.getLiteralValue());
  if (Node.isTrueLiteral(node)) return resolvedValue(true);
  if (Node.isFalseLiteral(node)) return resolvedValue(false);
  if (node.getKind() === SyntaxKind.NullKeyword) return resolvedValue(null);

  if (Node.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const element of node.getElements()) {
      const value = evaluateExpression(element, depth + 1);
      if (!value.resolved) return unresolvedValue(node.getText(), value.reason);
      out.push(value.value);
    }
    return resolvedValue(out);
  }

  if (Node.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const property of node.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        if (initializer === undefined) return unresolvedValue(node.getText(), 'property-without-value');
        const value = evaluateExpression(initializer, depth + 1);
        if (!value.resolved) return unresolvedValue(node.getText(), value.reason);
        out[property.getName().replace(/^['"]|['"]$/g, '')] = value.value;
        continue;
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        const value = evaluateExpression(property.getNameNode(), depth + 1);
        if (!value.resolved) return unresolvedValue(node.getText(), value.reason);
        out[property.getName()] = value.value;
        continue;
      }
      return unresolvedValue(node.getText(), 'spread-or-method-in-object');
    }
    return resolvedValue(out);
  }

  // `'/api/' + API_VERSION` is one string written in two pieces, and the
  // checker is no help here: the type of a `+` is the widened `string` even
  // when both sides are literals, so the type branch below cannot settle it.
  // Refusing it meant a mount written `app.use('/api/' + API_VERSION, router)`
  // placed no address at all and every route behind it was lost, while the same
  // address written as a template literal was read in full (R102).
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = evaluateExpression(node.getLeft(), depth + 1);
    if (!left.resolved) return unresolvedValue(node.getText(), left.reason);
    const right = evaluateExpression(node.getRight(), depth + 1);
    if (!right.resolved) return unresolvedValue(node.getText(), right.reason);
    // The same discipline the template-literal path keeps: a piece that cannot
    // be read leaves the whole thing unread, never half-read. Here that means
    // only the two operand kinds `+` has one obvious compile-time answer for.
    // `true + '/x'` and `{} + ''` are answers nobody wrote down on purpose, and
    // inventing an address from one is worse than reporting no address.
    const readable = (value: unknown): value is string | number =>
      typeof value === 'string' || typeof value === 'number';
    if (!readable(left.value) || !readable(right.value)) {
      return unresolvedValue(node.getText(), 'not-a-concatenation');
    }
    return typeof left.value === 'number' && typeof right.value === 'number'
      ? resolvedValue(left.value + right.value)
      : resolvedValue(`${left.value}${right.value}`);
  }

  // A literal type already carries the value: string enum members, `const`
  // bindings and `as const` all land here without any walking.
  if (Node.isExpression(node)) {
    const type = node.getType();
    if (type.isStringLiteral() || type.isNumberLiteral()) {
      return resolvedValue(type.getLiteralValue());
    }
    if (type.isBooleanLiteral()) return resolvedValue(type.getText() === 'true');
    // An `as const` array is a tuple of literal types, and the type is the only
    // place the values are when the declaration came from a package's `.d.ts`:
    // there is no initializer to walk, just `readonly ["a", "b"]` (R40).
    if (type.isTuple()) {
      const members = type.getTupleElements();
      const values: unknown[] = [];
      for (const member of members) {
        if (!member.isStringLiteral() && !member.isNumberLiteral()) {
          values.length = 0;
          break;
        }
        values.push(member.getLiteralValue());
      }
      if (values.length === members.length && members.length > 0) return resolvedValue(values);
    }
  }

  const declaration = declarationOf(node);
  if (declaration !== undefined) {
    if (Node.isEnumMember(declaration)) {
      const value = declaration.getValue();
      if (value !== undefined) return resolvedValue(value);
    }
    // A `let` or `var` holds its initializer at exactly one point in the
    // program; anywhere else it is whatever was last assigned. Reading the
    // initializer as "the value" turns a reassigned name into a confident wrong
    // answer, so only a `const` binding is followed.
    if (Node.isVariableDeclaration(declaration)) {
      const kind = declaration.getVariableStatement()?.getDeclarationKind();
      if (kind !== undefined && kind !== VariableDeclarationKind.Const) {
        return unresolvedValue(node.getText(), RUN_TIME_REASONS.reassignable);
      }
    }
    // A parameter holds whatever each caller hands it. It is not a constant
    // whose value could not be followed, and saying so would send a reader off
    // to move a constant that does not exist (R140).
    if (Node.isParameterDeclaration(declaration)) {
      return unresolvedValue(node.getText(), RUN_TIME_REASONS.parameter);
    }
    if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return evaluateExpression(initializer, depth + 1);
    }
  }

  // A property of a value bound at run time is bound at run time too:
  // `event.detail.type` read off a parameter is whatever each caller handed in,
  // and calling it a constant nobody could read is the same wrong advice R140
  // removed for the parameter itself.
  if (Node.isPropertyAccessExpression(node)) {
    const owner = evaluateExpression(node.getExpression(), depth + 1);
    if (!owner.resolved && RUN_TIME.has(owner.reason)) return unresolvedValue(node.getText(), owner.reason);
  }

  return unresolvedValue(node.getText());
};

/** Stable text for an object pattern, so the same pattern always yields the same id. */
export const stableKey = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
};

/**
 * The closed set of strings an expression's type allows, when it is one.
 *
 * `action: 'ship' | 'refund'` is a segment that was written down, in the
 * type system instead of in the expression. Nothing downstream ever asked the
 * type for it, so an address ending in one was read as though the segment were
 * unreadable, and fell through to whatever catch-all the target service serves
 * (R31).
 *
 * Only a union every arm of which is a string literal, and only up to `max` of
 * them. A single literal type answers with itself. Anything else — `string`, a
 * union with a `string` arm, an enum of numbers — answers with nothing, and the
 * hole stays a hole.
 */
export const literalUnionOf = (node: TsNode, max: number): string[] | null => {
  let type;
  try {
    type = node.getType();
  } catch {
    return null;
  }
  const arms = type.isUnion() ? type.getUnionTypes() : [type];
  if (arms.length === 0 || arms.length > max) return null;
  const members: string[] = [];
  for (const arm of arms) {
    if (!arm.isStringLiteral()) return null;
    const value = arm.getLiteralValue();
    if (typeof value !== 'string' || value === '') return null;
    if (!members.includes(value)) members.push(value);
  }
  return members.length === 0 ? null : members;
};
