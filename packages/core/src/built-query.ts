import type { Node as TsNode, PropertyAccessExpression, Symbol as TsSymbol } from 'ts-morph';
import { Node } from 'ts-morph';
import { writtenKeysOf } from './origin.js';

/**
 * A query built in code rather than written as an object (P258).
 *
 * A request's query is often not an object handed under `params`: it is a
 * class the platform or a client library gives, filled in by calls -
 * `new URLSearchParams({ status })`, `params.append('page', n)`, a chain of
 * `.set('a', x).set('b', y)` on a class whose `set` hands back a new one. The
 * keys are as plainly written as an object's are, one per call, so they are
 * read the same way: where every key is a literal, the query carries exactly
 * those; where one is not, nothing is said about which it carries.
 *
 * Which classes build a query, and how, is the reader's to say: the core
 * knows the shapes, not the names.
 */
export interface QueryBuilder {
  /** The class a query is made with: `new <class>(...)`. */
  readonly class: string;
  /** Where its constructor takes an object of keys: `''` the first argument itself, else a key of it. */
  readonly object?: string;
  /** Where it takes the text of a query (`a=1&b=2`): `''` the first argument itself, else a key of it. */
  readonly text?: string;
  /** Whether its first argument may be a list of pairs: `[['a', '1']]`. */
  readonly pairs?: boolean;
  /** Its methods that add a key, the key their first argument. */
  readonly adds: readonly string[];
  /**
   * Whether adding hands back a new query and leaves the one it is called on
   * as it was: then only `params = params.set(...)` and a chain add to it.
   */
  readonly immutable: boolean;
}

/**
 * The platform's own: `new URLSearchParams({ a })`, `('a=1')`, `([['a', '1']])`,
 * and `append` or `set` on the one made, which changes it in place.
 */
export const PLATFORM_QUERY: QueryBuilder = { class: 'URLSearchParams', object: '', text: '', pairs: true, adds: ['append', 'set'], immutable: false };

/** The platform's `Headers`: built as a query is, its names the keys (P258). */
export const PLATFORM_HEADERS: QueryBuilder = { class: 'Headers', object: '', pairs: true, adds: ['append', 'set'], immutable: false };

/** What a built query carries: its keys, where each is written, else nothing that can be said. */
export type BuiltQuery = { readonly keys: readonly string[] } | { readonly unread: true };

const UNREAD: BuiltQuery = { unread: true };

const unwrapped = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) at = at.getExpression();
  return at;
};

const literalText = (node: TsNode | undefined): string | undefined =>
  node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;

/** The keys of the text of a query: `a=1&b=2` is `a` and `b`. */
const keysOfText = (text: string): string[] =>
  text
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => decodeURIComponent(pair.split('=')[0] ?? ''));

const objectProperty = (object: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(key);
  if (property === undefined) return undefined;
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/** What a constructor is handed, as keys. */
const keysOfInit = (builder: QueryBuilder, argument: TsNode | undefined): BuiltQuery => {
  if (argument === undefined) return { keys: [] };
  const value = unwrapped(argument);
  const object = builder.object === undefined ? undefined : builder.object === '' ? value : objectProperty(value, builder.object);
  const text = builder.text === undefined ? undefined : builder.text === '' ? value : objectProperty(value, builder.text);
  if (text !== undefined) {
    const written = literalText(unwrapped(text));
    if (written !== undefined) return { keys: keysOfText(written) };
  }
  if (builder.pairs === true && Node.isArrayLiteralExpression(value)) {
    const keys: string[] = [];
    for (const element of value.getElements()) {
      const pair = unwrapped(element);
      const key = Node.isArrayLiteralExpression(pair) ? literalText(pair.getElements()[0]) : undefined;
      if (key === undefined) return UNREAD;
      keys.push(key);
    }
    return { keys };
  }
  if (object !== undefined) {
    const keys = writtenKeysOf([object]);
    if (keys !== undefined) return { keys };
  }
  // An object, or the text, the constructor is not handed in a form that says its keys.
  if (Node.isObjectLiteralExpression(value) && builder.object !== '' && object === undefined && text === undefined) return { keys: [] };
  return UNREAD;
};

const join = (parts: readonly BuiltQuery[]): BuiltQuery => {
  const keys = new Set<string>();
  for (const part of parts) {
    if ('unread' in part) return UNREAD;
    for (const key of part.keys) keys.add(key);
  }
  return { keys: [...keys].sort() };
};

/** The symbol a name stands for: in `{ params }`, the value it is written for, not the property. */
const symbolOf = (node: TsNode): TsSymbol | undefined => {
  const parent = node.getParent();
  return parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node ? parent.getValueSymbol() : node.getSymbol();
};

/**
 * The query a value is, where it is built by one of the builders: made in
 * place, a chain of adds on one, or a name holding one - with every add to it
 * written in the scope it is declared in. `undefined` where the value is no
 * built query at all, so a reader goes on to read it as it did.
 */
export const builtQueryOf = (node: TsNode, builders: readonly QueryBuilder[]): BuiltQuery | undefined => read(node, builders, new Set());

const read = (node: TsNode, builders: readonly QueryBuilder[], seen: Set<TsSymbol>): BuiltQuery | undefined => {
  let value = unwrapped(node);
  // `params.toString()`: the query it is the text of.
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'toString' && value.getArguments().length === 0) value = unwrapped(callee.getExpression());
  }
  if (Node.isNewExpression(value)) {
    const builder = builders.find((each) => value.getExpression().getText() === each.class);
    return builder === undefined ? undefined : keysOfInit(builder, value.getArguments()[0]);
  }
  // `new X().set('a', a).set('b', b)`, `params.set('a', a)`.
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const base = read(callee.getExpression(), builders, seen);
    if (base === undefined) return undefined;
    const builder = builderOf(callee.getExpression(), builders);
    if (builder === undefined || !builder.adds.includes(callee.getName())) return undefined;
    const key = literalText(unwrapped(value.getArguments()[0] ?? callee));
    return join([base, key === undefined ? UNREAD : { keys: [key] }]);
  }
  if (!Node.isIdentifier(value)) return undefined;
  const symbol = symbolOf(value);
  if (symbol === undefined) return undefined;
  // Read inside its own adds (`params = params.set(...)`): what is added, not the query again.
  if (seen.has(symbol)) return { keys: [] };
  const declaration = symbol.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  if (initializer === undefined) return undefined;
  const inner = new Set(seen).add(symbol);
  const made = read(initializer, builders, inner);
  if (made === undefined) return undefined;
  const builder = builderOf(initializer, builders);
  if (builder === undefined) return made;
  // Every add to it in the scope it is declared in.
  const scope = declaration.getFirstAncestor((ancestor) => Node.isBlock(ancestor) || Node.isSourceFile(ancestor)) ?? declaration.getSourceFile();
  const parts: BuiltQuery[] = [made];
  scope.forEachDescendant((each) => {
    if (builder.immutable) {
      if (!Node.isBinaryExpression(each) || each.getOperatorToken().getText() !== '=') return;
      const left = unwrapped(each.getLeft());
      if (!Node.isIdentifier(left) || symbolOf(left) !== symbol) return;
      const added = read(each.getRight(), builders, inner);
      parts.push(added ?? UNREAD);
      return;
    }
    if (!Node.isCallExpression(each)) return;
    const callee = each.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !builder.adds.includes(callee.getName())) return;
    const target = unwrapped(callee.getExpression());
    if (!Node.isIdentifier(target) || symbolOf(target) !== symbol) return;
    const key = literalText(unwrapped(each.getArguments()[0] ?? callee));
    parts.push(key === undefined ? UNREAD : { keys: [key] });
  });
  return join(parts);
};

/** The builder a chain of adds is made on, where it starts with `new <class>(...)` or a name holding one. */
const builderOf = (node: TsNode, builders: readonly QueryBuilder[]): QueryBuilder | undefined => {
  let at = unwrapped(node);
  for (;;) {
    if (Node.isNewExpression(at)) {
      const made = at.getExpression().getText();
      return builders.find((each) => each.class === made);
    }
    if (Node.isCallExpression(at) && Node.isPropertyAccessExpression(at.getExpression())) {
      at = unwrapped((at.getExpression() as PropertyAccessExpression).getExpression());
      continue;
    }
    if (Node.isIdentifier(at)) {
      const declaration = symbolOf(at)?.getDeclarations()[0];
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      if (initializer === undefined || initializer === node) return undefined;
      at = unwrapped(initializer);
      continue;
    }
    return undefined;
  }
};

/**
 * The names of the headers a request's options write (P258), lower-cased as
 * a server hands them on: an object written in place, or one built by the
 * builders given. `undefined` where they are not written so.
 */
export const writtenHeaderNames = (written: TsNode, builders: readonly QueryBuilder[]): readonly string[] | undefined => {
  const built = builtQueryOf(written, builders);
  const keys = built === undefined ? writtenKeysOf([written]) : 'unread' in built ? undefined : built.keys;
  return keys === undefined ? undefined : [...new Set(keys.map((key) => key.toLowerCase()))].sort();
};

/**
 * The query an address carries in its text, where it is built in code:
 * `` `/orders?${params}` `` or `'/orders?' + params.toString()` (P258). Only
 * the part after `?` (or after an `&` past it) is read; `undefined` where
 * the address holds none.
 */
export const builtQueryInAddress = (address: TsNode, builders: readonly QueryBuilder[]): BuiltQuery | undefined => {
  const value = unwrapped(address);
  const found: BuiltQuery[] = [];
  if (Node.isTemplateExpression(value)) {
    let before = value.getHead().getLiteralText();
    for (const span of value.getTemplateSpans()) {
      if (/[?&]$/.test(before) || (before.includes('?') && /&$/.test(before))) {
        const built = builtQueryOf(span.getExpression(), builders);
        if (built !== undefined) found.push(built);
      }
      before += `\u0000${span.getLiteral().getLiteralText()}`;
    }
  } else if (Node.isBinaryExpression(value) && value.getOperatorToken().getText() === '+') {
    const left = unwrapped(value.getLeft());
    const text = literalText(left) ?? (Node.isTemplateExpression(left) ? left.getTemplateSpans().at(-1)?.getLiteral().getLiteralText() : undefined);
    if (text !== undefined && /[?&]$/.test(text)) {
      const built = builtQueryOf(value.getRight(), builders);
      if (built !== undefined) found.push(built);
    }
  }
  return found.length === 0 ? undefined : join(found);
};
