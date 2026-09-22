import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

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

/** The declaration an identifier or a member access names, following imports. */
export const declarationOf = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return undefined;
  const symbol = node.getSymbol();
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
    if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return evaluateExpression(initializer, depth + 1);
    }
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
