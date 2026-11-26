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
 * A name may stand for a node written otherwise (P338): the key an entry is
 * kept under in an object of entries (its name, `start` of `{ start: {...} }`,
 * or the expression a computed key or a reduce writes it under), taken out
 * of a `[key, entry]` pair, or an entry written as something other than an
 * object (`Start` of `{ start: Start }`).
 */
export type Bindings = ReadonlyMap<TsNode, ObjectLiteralExpression | TsNode | IndexKey>;

/**
 * The key an item of a list is kept under where the list is read as `[key,
 * entry]` pairs (`Object.entries(['a', 'b'])`, P344): its place, which no
 * node of the source spells. One per place, so two readings bind the same.
 */
export interface IndexKey {
  readonly index: number;
}

const INDEX_KEYS = new Map<number, IndexKey>();

/** The key of the item at a place of a list. */
export const indexKey = (index: number): IndexKey => {
  const known = INDEX_KEYS.get(index);
  if (known !== undefined) return known;
  const made: IndexKey = Object.freeze({ index });
  INDEX_KEYS.set(index, made);
  return made;
};

/** Whether a bound value is a list item's place rather than a node. */
export const isIndexKey = (value: unknown): value is IndexKey => typeof value === 'object' && value !== null && !(value instanceof Node) && typeof (value as IndexKey).index === 'number';

/** The declarations a name stands for: a shorthand property's value (`{ path }` names the `path` in scope, P338), or its own. */
export const namedDeclarations = (name: TsNode): TsNode[] => {
  const parent = name.getParent();
  if (parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === name) return parent.getValueSymbol()?.getDeclarations() ?? [];
  return name.getSymbol()?.getDeclarations() ?? [];
};

/** The entry object one of the declarations is bound to, where one is bound to one. */
export const boundObject = (bindings: Bindings | undefined, declarations: readonly TsNode[]): ObjectLiteralExpression | undefined => {
  for (const declaration of declarations) {
    const bound = bindings?.get(declaration);
    if (bound !== undefined && !isIndexKey(bound) && Node.isObjectLiteralExpression(bound)) return bound;
  }
  return undefined;
};

/** The node other than an entry object one of the declarations stands for (P338): a key, or an entry written otherwise. */
export const boundNode = (bindings: Bindings | undefined, declarations: readonly TsNode[]): TsNode | undefined => {
  for (const declaration of declarations) {
    const bound = bindings?.get(declaration);
    if (bound !== undefined && !isIndexKey(bound) && !Node.isObjectLiteralExpression(bound)) return bound;
  }
  return undefined;
};

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
    // An entry looked up by the key it is kept under (`pages[name]` over `Object.keys(pages)`, P344): bound itself.
    if (bindings.has(at)) break;
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
  if (keys.length === 0) return undefined;
  const object = bindings.has(at) ? boundObject(bindings, [at]) : Node.isIdentifier(at) ? boundObject(bindings, at.getSymbol()?.getDeclarations() ?? []) : undefined;
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
    let node = bare(found.node);
    // A name the entry's object reads that is bound itself - a parameter of the adding function the object is written in, bound to
    // what each call hands (P351): what it stands for.
    if (Node.isIdentifier(node)) {
      const declarations = namedDeclarations(node);
      const object = boundObject(bindings, declarations);
      const other = object === undefined ? boundNode(bindings, declarations) : undefined;
      if (object !== undefined) node = object;
      else if (other !== undefined) {
        node = bare(other);
        if (rest.length === 0 || !Node.isObjectLiteralExpression(node)) return { found: { node: other }, rest };
      }
    }
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
    return { found: node === bare(found.node) ? found : { node }, rest };
  }
  return undefined;
};

/** What a node stands for where it is bound (P338, P344): a name's declaration bound to a node other than an entry object, or an entry looked up by its key (`pages[name]`). */
export const standsFor = (bindings: Bindings | undefined, node: TsNode): TsNode | undefined => {
  if (bindings === undefined || bindings.size === 0) return undefined;
  if (bindings.has(node)) return boundNode(bindings, [node]);
  return Node.isIdentifier(node) ? boundNode(bindings, namedDeclarations(node)) : undefined;
};

/**
 * The node a value written in an object stands for (P344): a shorthand's
 * name (`{ Screen }`) the name it is declared under, through an import, so
 * what it holds is read; any other value itself.
 */
const valueNodeOf = (node: TsNode): TsNode => {
  const parent = node.getParent();
  if (parent === undefined || !Node.isShorthandPropertyAssignment(parent) || parent.getNameNode() !== node) return node;
  const symbol = parent.getValueSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration !== undefined && (Node.isVariableDeclaration(declaration) || Node.isFunctionDeclaration(declaration) || Node.isClassDeclaration(declaration))) return declaration.getNameNode() ?? node;
  return node;
};

/** The object a value is written as: in place, or a `const` holding one. */
const objectWritten = (node: TsNode): ObjectLiteralExpression | undefined => {
  const value = bare(node);
  return Node.isObjectLiteralExpression(value) ? value : heldObject(value);
};

/** A property's key as text, its quotes taken off. */
const unquoted = (text: string): string => (/^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text);

/**
 * What the names an object binding pattern takes out of an entry stand for
 * (P344): `([path, { Screen, title = 'Home' }]) => ...` binds `Screen` and
 * `title` to the entry's own values under those keys - an object written in
 * place bound as an entry, so its members are read, anything else as the
 * node it stands for - a nested pattern (`{ meta: { title } }`) taken out of
 * that value in turn, and a name whose key the entry does not write to its
 * default, where it has one. A rest element, a computed key, and a value of
 * a JSON module are not bound.
 */
export const patternBindings = (pattern: TsNode, entry: TsNode, into: Map<TsNode, ObjectLiteralExpression | TsNode | IndexKey>, depth = 0): void => {
  if (depth > 6 || !Node.isObjectBindingPattern(pattern)) return;
  const object = objectWritten(entry);
  if (object === undefined) return;
  for (const element of pattern.getElements()) {
    if (element.getDotDotDotToken() !== undefined) continue;
    const property = element.getPropertyNameNode();
    if (property !== undefined && Node.isComputedPropertyName(property)) continue;
    const name = element.getNameNode();
    const key = property !== undefined ? unquoted(property.getText()) : Node.isIdentifier(name) ? name.getText() : undefined;
    if (key === undefined) continue;
    const found = memberOf(object, key);
    const value = found === undefined ? element.getInitializer() : 'node' in found ? valueNodeOf(found.node) : undefined;
    if (value === undefined) continue;
    if (Node.isObjectBindingPattern(name)) {
      patternBindings(name, value, into, depth + 1);
      continue;
    }
    if (Node.isIdentifier(name)) into.set(element, objectWritten(value) ?? value);
  }
};

/** Whether an expression reads a name bound to the given declaration anywhere inside it. */
export const reads = (node: TsNode, declaration: TsNode, name: string): boolean =>
  node.getDescendantsOfKind(SyntaxKind.Identifier).some((each) => each.getText() === name && (each.getSymbol()?.getDeclarations() ?? []).includes(declaration as never));
