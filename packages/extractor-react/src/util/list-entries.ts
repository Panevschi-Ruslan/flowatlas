import { evaluateExpression } from '@flowatlas/core';
import type { ClassDeclaration, MethodDeclaration, Node as TsNode, ObjectLiteralExpression, ParameterDeclaration } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { memberOf, reads, type Bindings } from './bound-entries.js';

/**
 * The entries of a list a route table is built from (P291): `configs.map(
 * (config) => <Route path={config.path} component={config.component} />)`
 * over the items a hook, a `const` or a function of the repository hands
 * back, each entry an object written in place.
 */
export interface ListEntries {
  /** The objects written as the list's items, each with the elements it is written over bound (P297). */
  readonly entries: readonly ListEntry[];
  /** Items written as something other than an object in place, or added from code that is not read. */
  readonly unread: number;
}

/** One entry of a list: the object written for it, and the elements of other lists it is written over (P297). */
export interface ListEntry {
  readonly object: ObjectLiteralExpression;
  readonly bound?: Bindings;
}

const sameBindings = (a: Bindings | undefined, b: Bindings | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
};

/** The methods of a list that run a function on each of its elements, the element handed first. */
const ELEMENT_METHODS: ReadonlySet<string> = new Set(['forEach', 'map', 'flatMap']);

/**
 * The list an object is written over, where it is written inside a function
 * handed to a list's `forEach` / `map` / `flatMap`, or inside a `for...of`,
 * and reads the element: the list, and the name the element is bound to.
 */
const iteratedOver = (object: ObjectLiteralExpression): { readonly list: TsNode; readonly parameter: TsNode } | undefined => {
  for (let at: TsNode | undefined = object.getParent(); at !== undefined && !Node.isSourceFile(at); at = at.getParent()) {
    if (Node.isArrowFunction(at) || Node.isFunctionExpression(at)) {
      const [parameter] = at.getParameters();
      const call = at.getParent();
      if (parameter === undefined || !Node.isIdentifier(parameter.getNameNode()) || call === undefined || !Node.isCallExpression(call) || !call.getArguments().includes(at as never)) continue;
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || !ELEMENT_METHODS.has(callee.getName())) continue;
      if (reads(object, parameter, parameter.getName())) return { list: callee.getExpression(), parameter };
      continue;
    }
    if (Node.isForOfStatement(at)) {
      const initializer = at.getInitializer();
      const [declaration] = Node.isVariableDeclarationList(initializer) ? initializer.getDeclarations() : [];
      if (declaration === undefined || !Node.isIdentifier(declaration.getNameNode())) continue;
      if (reads(object, declaration, declaration.getName())) return { list: at.getExpression(), parameter: declaration };
    }
    if (Node.isFunctionDeclaration(at) || Node.isMethodDeclaration(at) || Node.isClassDeclaration(at)) return undefined;
  }
  return undefined;
};

/** The methods of a store that add to it. */
const STORING_METHODS: ReadonlySet<string> = new Set(['push', 'unshift', 'splice', 'set', 'add']);

/** A class of the repository a receiver names, and the `const` holding an instance of it where it names one. */
const registryClassOf = (receiver: TsNode): { readonly cls: ClassDeclaration; readonly instance?: TsNode } | undefined => {
  if (!Node.isIdentifier(receiver)) return undefined;
  const symbol = receiver.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile() || declaration.getSourceFile().getFilePath().includes('/node_modules/')) return undefined;
  if (Node.isClassDeclaration(declaration)) return { cls: declaration };
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const made = declaration.getInitializer();
  const created = made === undefined ? undefined : bare(made);
  if (created === undefined || !Node.isNewExpression(created)) return undefined;
  const found = registryClassOf(created.getExpression());
  return found === undefined || found.instance !== undefined ? undefined : { cls: found.cls, instance: declaration };
};

/** The fields of a class a method reads: `this.plugins`, `Registry.plugins`. */
const fieldsReadBy = (cls: ClassDeclaration, method: MethodDeclaration): Set<string> => {
  const fields = new Set<string>();
  method.forEachDescendant((node) => {
    if (!Node.isPropertyAccessExpression(node)) return;
    const owner = node.getExpression();
    if (!Node.isThisExpression(owner) && !(Node.isIdentifier(owner) && owner.getText() === cls.getName())) return;
    if (cls.getProperty(node.getName()) !== undefined || cls.getStaticProperty(node.getName()) !== undefined) fields.add(node.getName());
  });
  return fields;
};

/** Whether an expression reads one of these fields of the class. */
const readsField = (node: TsNode, cls: ClassDeclaration, fields: ReadonlySet<string>): boolean =>
  [node, ...node.getDescendants()].some((each) => {
    if (!Node.isPropertyAccessExpression(each) || !fields.has(each.getName())) return false;
    const owner = each.getExpression();
    return Node.isThisExpression(owner) || (Node.isIdentifier(owner) && owner.getText() === cls.getName());
  });

/** The methods of the class a method calls on itself: `this.register(...)`. */
const ownCalls = (cls: ClassDeclaration, method: MethodDeclaration): MethodDeclaration[] =>
  method.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return [];
    const owner = callee.getExpression();
    if (!Node.isThisExpression(owner) && !(Node.isIdentifier(owner) && owner.getText() === cls.getName())) return [];
    const called = cls.getMethods().find((each) => each.getName() === callee.getName() && each.getBody() !== undefined);
    return called === undefined ? [] : [called];
  });

/** Whether a method adds to one of these fields, itself or through a method of the class it calls; the key it files an entry under (`plugin.type`) where it reads one. */
const storing = (cls: ClassDeclaration, method: MethodDeclaration, fields: ReadonlySet<string>, depth = 0): { readonly key?: string } | undefined => {
  if (depth > 3) return undefined;
  let stores = false;
  let key: string | undefined;
  method.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && STORING_METHODS.has(callee.getName()) && readsField(callee.getExpression(), cls, fields)) stores = true;
      // `this.plugins.get(plugin.type)`: the entry's key.
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'get' && readsField(callee.getExpression(), cls, fields)) {
        const [first] = node.getArguments();
        if (first !== undefined && Node.isPropertyAccessExpression(first) && Node.isIdentifier(first.getExpression())) key ??= first.getName();
      }
    }
    const left = Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '=' ? node.getLeft() : undefined;
    if (left !== undefined && Node.isElementAccessExpression(left) && readsField(left, cls, fields)) {
      stores = true;
      const index = left.getArgumentExpression();
      if (index !== undefined && Node.isPropertyAccessExpression(index) && Node.isIdentifier(index.getExpression())) key ??= index.getName();
    }
  });
  for (const called of ownCalls(cls, method)) {
    const inner = called === method ? undefined : storing(cls, called, fields, depth + 1);
    if (inner === undefined) continue;
    stores = true;
    key ??= inner.key;
  }
  return stores ? (key === undefined ? {} : { key }) : undefined;
};

/** The parameter of a method its store is read by: `this.plugins.get(type)` is the first. */
const readKeyIndex = (cls: ClassDeclaration, method: MethodDeclaration, fields: ReadonlySet<string>): number | undefined => {
  const parameters = method.getParameters();
  let found: number | undefined;
  method.forEachDescendant((node, traversal) => {
    let index: TsNode | undefined;
    const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (Node.isCallExpression(node) && callee !== undefined && Node.isPropertyAccessExpression(callee)) {
      if (callee.getName() === 'get' && readsField(callee.getExpression(), cls, fields)) index = node.getArguments()[0];
    } else if (Node.isElementAccessExpression(node) && readsField(node.getExpression(), cls, fields)) index = node.getArgumentExpression();
    if (index === undefined || !Node.isIdentifier(index)) return;
    const at = parameters.findIndex((parameter) => (index.getSymbol()?.getDeclarations() ?? []).includes(parameter as never));
    if (at === -1) return;
    found = at;
    traversal.stop();
  });
  return found;
};

const REGISTRIES = new WeakMap<TsNode, { readonly items: readonly TsNode[]; readonly unread: number } | null>();

/**
 * The entries a registry of the repository's own holds, where a list is read
 * off it (P297): `PluginManager.getHooks(Hook.Settings)` - a method of a
 * class of the repository reading a field of it (`this.plugins.get(type)`) -
 * is every entry handed, anywhere in the repository, to a method of the same
 * class that adds to that field (`PluginManager.add([{ type: Hook.Settings,
 * value }])`, itself or through `this.register(plugin)`); where the reading
 * method looks the store up by a parameter and the adding one files an entry
 * by one of its keys (`this.plugins.get(plugin.type)`), only the entries
 * whose key is written as the call's argument is. A class held in a `const`
 * as an instance (`const registry = new Registry()`) is read the same way,
 * its adding calls on that `const`.
 */
const registryEntries = (call: TsNode): { readonly items: readonly TsNode[]; readonly unread: number } | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const known = REGISTRIES.get(call);
  if (known !== undefined) return known ?? undefined;
  REGISTRIES.set(call, null);
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const owner = registryClassOf(bare(callee.getExpression()));
  if (owner === undefined) return undefined;
  const { cls, instance } = owner;
  const reader = (instance === undefined ? cls.getStaticMethod(callee.getName()) : cls.getInstanceMethod(callee.getName())) as MethodDeclaration | undefined;
  if (reader === undefined || reader.getBody() === undefined) return undefined;
  const fields = fieldsReadBy(cls, reader);
  if (fields.size === 0) return undefined;
  const adders = new Map<string, { readonly key?: string }>();
  for (const method of cls.getMethods()) {
    if (method === reader || method.isStatic() !== (instance === undefined) || method.getBody() === undefined) continue;
    const stores = storing(cls, method, fields);
    if (stores !== undefined) adders.set(method.getName(), stores);
  }
  if (adders.size === 0) return undefined;
  const keyIndex = readKeyIndex(cls, reader, fields);
  const keyArgument = keyIndex === undefined ? undefined : call.getArguments()[keyIndex];
  const items: TsNode[] = [];
  let unread = 0;
  const matches = (item: TsNode, key: string | undefined): boolean => {
    if (key === undefined || keyArgument === undefined) return true;
    const object = bare(item);
    if (!Node.isObjectLiteralExpression(object)) return true;
    const written = memberOf(object, key);
    if (written === undefined) return false;
    if ('value' in written) {
      const argument = evaluateExpression(keyArgument);
      return argument.resolved && written.value === argument.value;
    }
    const text = (node: TsNode): string => bare(node).getText().replace(/\s+/g, '');
    if (text(written.node) === text(keyArgument)) return true;
    const left = evaluateExpression(written.node);
    const right = evaluateExpression(keyArgument);
    return left.resolved && right.resolved && left.value === right.value;
  };
  for (const source of call.getSourceFile().getProject().getSourceFiles()) {
    if (source.isDeclarationFile() || source.getFilePath().includes('/node_modules/')) continue;
    const text = source.getFullText();
    if (![...adders.keys()].some((name) => text.includes(`.${name}(`))) continue;
    for (const adding of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = adding.getExpression();
      if (!Node.isPropertyAccessExpression(target)) continue;
      const adder = adders.get(target.getName());
      if (adder === undefined) continue;
      const receiver = bare(target.getExpression());
      if (Node.isThisExpression(receiver)) continue;
      const added = registryClassOf(receiver);
      if (added === undefined || added.cls !== cls || added.instance !== instance) continue;
      for (const argument of adding.getArguments().slice(0, 1)) {
        const value = bare(argument);
        const handed = Node.isArrayLiteralExpression(value) ? value.getElements() : [value];
        for (const each of handed) {
          if (items.length >= MOST) break;
          if (!Node.isObjectLiteralExpression(bare(each)) && !Node.isSpreadElement(each)) {
            unread += 1;
            continue;
          }
          if (matches(each, adder.key)) items.push(each);
        }
      }
    }
  }
  const read = { items, unread };
  REGISTRIES.set(call, read);
  return read;
};

/** How many steps a list is followed through names, calls and the functions that hand it back. */
const DEPTH = 6;
/** At most this many entries from one list. */
const MOST = 400;

/** The methods of a list that hand back some of its own items, in some order. */
const SUBSET_METHODS: ReadonlySet<string> = new Set(['filter', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'concat']);

/** The methods of a list that add items to it where it is kept: `push(...)`, `unshift(...)`, `splice(at, 0, ...)`. */
const ADDING_METHODS: ReadonlyMap<string, number> = new Map([
  ['push', 0],
  ['unshift', 0],
  ['splice', 2],
]);

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value) || Node.isAwaitExpression(value) || Node.isTypeAssertion(value)) value = value.getExpression();
  return value;
};

/** The expressions a function hands back: its concise body, or each of its own `return`s. */
const returnedBy = (fn: TsNode): TsNode[] => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return [];
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  const found: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) {
      const value = node.getExpression();
      if (value !== undefined) found.push(value);
    }
  });
  return found;
};

/** The function of this repository a callee names, written with a body. */
const calledFunction = (callee: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  const symbol = callee.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) continue;
    if (Node.isFunctionDeclaration(declaration) && declaration.getBody() !== undefined) return declaration;
    if (Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      const fn = value === undefined ? undefined : bare(value);
      if (fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return fn;
    }
    if (Node.isExportAssignment(declaration)) {
      const fn = bare(declaration.getExpression());
      if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) return fn;
      if (Node.isIdentifier(fn)) return calledFunction(fn);
    }
  }
  return undefined;
};

/** The items added to a list kept under a name, by `push`, `unshift` or `splice` written where the name is in scope. */
const addedTo = (declaration: TsNode): TsNode[] => {
  if (!Node.isVariableDeclaration(declaration)) return [];
  const scope = declaration.getFirstAncestor((node) => Node.isBlock(node) || Node.isSourceFile(node));
  if (scope === undefined) return [];
  const name = declaration.getName();
  const added: TsNode[] = [];
  scope.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const from = ADDING_METHODS.get(callee.getName());
    const receiver = bare(callee.getExpression());
    if (from === undefined || !Node.isIdentifier(receiver) || receiver.getText() !== name) return;
    if (!receiver.getSymbol()?.getDeclarations().includes(declaration as never)) return;
    added.push(...node.getArguments().slice(from));
  });
  return added;
};

/**
 * The objects a list expression's items are written as: an array written in
 * place (its spreads followed), a name holding one (with what is pushed onto
 * it), a list's own `filter` / `slice` / `sort` / `concat`, a function of the
 * repository that hands one back, and a call handed a function that hands
 * one back (`useMemo(() => [...])`, a computed value). An item written as
 * anything else is counted as not read.
 */
export const listEntries = (expression: TsNode, outerDepth = 0): ListEntries | undefined => {
  const entries: ListEntry[] = [];
  let unread = 0;
  const seen = new Set<TsNode>();

  const push = (entry: ListEntry): void => {
    if (entries.length >= MOST || entries.some((each) => each.object === entry.object && sameBindings(each.bound, entry.bound))) return;
    entries.push(entry);
  };

  const item = (node: TsNode, depth: number): void => {
    const value = bare(node);
    if (Node.isObjectLiteralExpression(value)) {
      // An object written over the elements of another list is one entry per element (P297).
      const over = iteratedOver(value);
      if (over === undefined || outerDepth >= 2) {
        push({ object: value });
        return;
      }
      const outer = listEntries(over.list, outerDepth + 1);
      // A list no element of which is written (one filled when the application runs): the entry is not read.
      if (outer === undefined || outer.entries.length === 0) {
        unread += Math.max(1, outer?.unread ?? 0);
        return;
      }
      unread += outer.unread;
      for (const element of outer.entries) push({ object: value, bound: new Map([...(element.bound ?? []), [over.parameter, element.object]]) });
      return;
    }
    if (Node.isSpreadElement(value)) {
      if (!list(value.getExpression(), depth + 1)) unread += 1;
      return;
    }
    if (Node.isIdentifier(value)) {
      const declaration = (value.getSymbol()?.getAliasedSymbol() ?? value.getSymbol())?.getDeclarations()[0];
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      if (initializer !== undefined && depth < DEPTH) {
        item(initializer, depth + 1);
        return;
      }
    }
    unread += 1;
  };

  /** Whether an expression was read as a list, its items taken. */
  const list = (node: TsNode, depth: number): boolean => {
    if (depth > DEPTH) return false;
    const value = bare(node);
    if (seen.has(value)) return true;
    seen.add(value);
    if (Node.isArrayLiteralExpression(value)) {
      for (const element of value.getElements()) item(element, depth);
      return true;
    }
    if (Node.isConditionalExpression(value)) return [value.getWhenTrue(), value.getWhenFalse()].map((side) => list(side, depth + 1)).some(Boolean);
    if (Node.isBinaryExpression(value) && ['??', '||'].includes(value.getOperatorToken().getText())) {
      return [value.getLeft(), value.getRight()].map((side) => list(side, depth + 1)).some(Boolean);
    }
    if (Node.isIdentifier(value)) {
      const symbol = value.getSymbol();
      const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
      if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return false;
      const initializer = declaration.getInitializer();
      if (initializer === undefined || !list(initializer, depth + 1)) return false;
      for (const added of addedTo(declaration)) item(added, depth + 1);
      return true;
    }
    if (!Node.isCallExpression(value)) return false;
    const callee = value.getExpression();
    // A registry of the repository's own read by a method: the entries handed to its adding methods (P297).
    const registered = registryEntries(value);
    if (registered !== undefined) {
      for (const each of registered.items) item(each, depth + 1);
      unread += registered.unread;
      return true;
    }
    if (Node.isPropertyAccessExpression(callee) && SUBSET_METHODS.has(callee.getName())) {
      const read = list(callee.getExpression(), depth + 1);
      if (callee.getName() === 'concat') for (const argument of value.getArguments()) if (!list(argument, depth + 1)) item(argument, depth + 1);
      return read;
    }
    // A function of the repository that hands the list back, then a call handed one that does.
    const fn = calledFunction(callee);
    if (fn !== undefined && returnedBy(fn).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    for (const argument of value.getArguments()) {
      const handed = bare(argument);
      if (!Node.isArrowFunction(handed) && !Node.isFunctionExpression(handed)) continue;
      if (returnedBy(handed).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    }
    return false;
  };

  return list(expression, 0) ? { entries, unread } : undefined;
};

/**
 * The list a value of a route is read from, and the key of its items it
 * reads: `config.path` or a name taken out of the item (`({ path }) => ...`)
 * where `config` is the parameter of a function handed to the list's `map`
 * or `flatMap`.
 */
export const listedKey = (value: TsNode): { readonly list: TsNode; readonly key: string; readonly parameter: ParameterDeclaration } | undefined => {
  const node = bare(Node.isJsxExpression(value) ? (value.getExpression() ?? value) : value);
  let name: TsNode | undefined;
  let key: string | undefined;
  if (Node.isPropertyAccessExpression(node)) {
    name = bare(node.getExpression());
    key = node.getName();
  } else if (Node.isIdentifier(node)) {
    name = node;
  }
  if (name === undefined || !Node.isIdentifier(name)) return undefined;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    let parameter: TsNode | undefined = declaration;
    let taken = key;
    if (Node.isBindingElement(declaration)) {
      // `({ path, component: Screen }) => ...`: the key is the property the name is taken from.
      if (key !== undefined) return undefined;
      taken = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      parameter = declaration.getParent()?.getParent();
    } else if (key === undefined) return undefined;
    if (parameter === undefined || !Node.isParameterDeclaration(parameter) || taken === undefined) continue;
    const fn = parameter.getParent();
    if ((!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== parameter) continue;
    const call = fn.getParent();
    if (call === undefined || !Node.isCallExpression(call) || !call.getArguments().includes(fn as never)) continue;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !['map', 'flatMap'].includes(callee.getName())) continue;
    return { list: callee.getExpression(), key: taken, parameter };
  }
  return undefined;
};
