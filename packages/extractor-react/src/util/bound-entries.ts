import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The entries of a list an element stands for, each bound to what it is
 * (P297): an object written inside a function handed to another list's
 * `forEach` / `map` (`plugins.forEach((plugin) => items.push({ path:
 * pluginPath(plugin.id) }))`) is one entry per element of that list, the
 * callback's parameter bound, in each, to that element. A member read off a
 * bound name (`plugin.id`, `plugin.value.component`) is the element's own
 * value under that key, through its spreads - another object, a `const`
 * holding one, a JSON module imported (`...config` from `../plugin.json`).
 */
export type Bindings = ReadonlyMap<TsNode, ObjectLiteralExpression>;

/** What a member of an entry is: a value written in the source, or a value of a JSON module. */
export type MemberValue = { readonly node: TsNode } | { readonly value: unknown };

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value) || Node.isTypeAssertion(value)) value = value.getExpression();
  return value;
};

const JSON_MODULES = new Map<string, unknown>();

/** The value a JSON module a name is imported from holds, where it is one (`import config from '../plugin.json'`). */
const jsonImported = (name: TsNode): unknown => {
  if (!Node.isIdentifier(name)) return undefined;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    const clause = Node.isImportClause(declaration) ? declaration : undefined;
    const imported = clause?.getParent();
    if (imported === undefined || !Node.isImportDeclaration(imported)) continue;
    const specifier = imported.getModuleSpecifierValue();
    if (!specifier.endsWith('.json') || !specifier.startsWith('.')) continue;
    const path = resolve(dirname(imported.getSourceFile().getFilePath()), specifier);
    if (!JSON_MODULES.has(path)) {
      let read: unknown;
      try {
        read = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
      } catch {
        read = undefined;
      }
      JSON_MODULES.set(path, read);
    }
    return JSON_MODULES.get(path);
  }
  return undefined;
};

/** The object literal a name holds where it is a `const` written with one. */
const heldObject = (name: TsNode): ObjectLiteralExpression | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const symbol = name.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const value = declaration.getInitializer();
  const object = value === undefined ? undefined : bare(value);
  return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
};

/**
 * The value an object written in place holds under a key: the last property
 * that writes it, through spreads of another object, a `const` holding one,
 * or a JSON module. Nothing where no property writes it.
 */
export const memberOf = (object: ObjectLiteralExpression, key: string, depth = 0): MemberValue | undefined => {
  if (depth > 6) return undefined;
  const properties = object.getProperties();
  for (let at = properties.length - 1; at >= 0; at -= 1) {
    const property = properties[at] as TsNode;
    if (Node.isPropertyAssignment(property) && property.getName().replace(/^['"]|['"]$/g, '') === key) {
      const value = property.getInitializer();
      return value === undefined ? undefined : { node: value };
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === key) return { node: property.getNameNode() };
    if (Node.isMethodDeclaration(property) && property.getName() === key) return { node: property };
    if (!Node.isSpreadAssignment(property)) continue;
    const spread = bare(property.getExpression());
    if (Node.isObjectLiteralExpression(spread)) {
      const found = memberOf(spread, key, depth + 1);
      if (found !== undefined) return found;
      continue;
    }
    const held = heldObject(spread);
    if (held !== undefined) {
      const found = memberOf(held, key, depth + 1);
      if (found !== undefined) return found;
      continue;
    }
    const json = jsonImported(spread);
    if (json !== null && typeof json === 'object' && key in (json as Record<string, unknown>)) return { value: (json as Record<string, unknown>)[key] };
  }
  return undefined;
};

/** What a member read off a bound name is: its value, the keys still to read past it, or `absent` where the entry writes no such key. */
export type BoundRead = { readonly found: MemberValue; readonly rest: readonly string[] } | 'absent';

/**
 * What an expression reads off a bound entry: `plugin.value.component.Component`
 * is the entry's `value`'s `component` (the `createLazyComponent(...)` it is
 * written as) with `Component` still to read; nothing where the expression
 * is not rooted at a bound name.
 */
export const boundRead = (expression: TsNode, bindings: Bindings | undefined): BoundRead | undefined => {
  if (bindings === undefined || bindings.size === 0) return undefined;
  const keys: string[] = [];
  let at = bare(expression);
  for (;;) {
    if (Node.isPropertyAccessExpression(at)) {
      keys.unshift(at.getName());
      at = bare(at.getExpression());
      continue;
    }
    const index = Node.isElementAccessExpression(at) ? at.getArgumentExpression() : undefined;
    if (!Node.isElementAccessExpression(at) || index === undefined || !Node.isStringLiteral(index)) break;
    keys.unshift(index.getLiteralValue());
    at = bare(at.getExpression());
  }
  if (!Node.isIdentifier(at) || keys.length === 0) return undefined;
  const object = (at.getSymbol()?.getDeclarations() ?? []).map((declaration) => bindings.get(declaration)).find((each) => each !== undefined);
  if (object === undefined) return undefined;
  let current: ObjectLiteralExpression = object;
  for (let index = 0; index < keys.length; index += 1) {
    const found = memberOf(current, keys[index] as string);
    if (found === undefined) return 'absent';
    const rest = keys.slice(index + 1);
    if ('value' in found) {
      let value = found.value;
      for (const key of rest) value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      return value === undefined ? 'absent' : { found: { value }, rest: [] };
    }
    const node = bare(found.node);
    if (rest.length > 0 && Node.isObjectLiteralExpression(node)) {
      current = node;
      continue;
    }
    if (rest.length > 0) {
      const held = heldObject(node);
      if (held !== undefined) {
        current = held;
        continue;
      }
    }
    return { found, rest };
  }
  return undefined;
};

/** Whether an expression reads a name bound to the given declaration anywhere inside it. */
export const reads = (node: TsNode, declaration: TsNode, name: string): boolean =>
  node.getDescendantsOfKind(SyntaxKind.Identifier).some((each) => each.getText() === name && (each.getSymbol()?.getDeclarations() ?? []).includes(declaration as never));
