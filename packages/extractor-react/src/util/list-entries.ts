import { evaluateExpression } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, MethodDeclaration, Node as TsNode, ObjectLiteralExpression, ParameterDeclaration, VariableDeclaration } from 'ts-morph';
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

/**
 * The value an entry writes under a key: its own property, or one of the
 * object it spreads - an object written in place, a `const` holding one, or
 * the element it is written over (`{ ...route, path: base + route.path }`
 * spreading `route`, P314) - the last that writes it.
 */
export const entryValue = (entry: ListEntry, key: string): TsNode | undefined => {
  const valueIn = (object: ObjectLiteralExpression, depth: number): TsNode | undefined => {
    if (depth > 6) return undefined;
    const properties = object.getProperties();
    for (let at = properties.length - 1; at >= 0; at -= 1) {
      const property = properties[at] as TsNode;
      if (Node.isPropertyAssignment(property) && property.getName().replace(/^['"]|['"]$/g, '') === key) return property.getInitializer();
      if (Node.isShorthandPropertyAssignment(property) && property.getName() === key) return property.getNameNode();
      if (!Node.isSpreadAssignment(property)) continue;
      const spread = bare(property.getExpression());
      const bound = Node.isIdentifier(spread) ? (spread.getSymbol()?.getDeclarations() ?? []).map((declaration) => entry.bound?.get(declaration)).find((each) => each !== undefined) : undefined;
      const inner = Node.isObjectLiteralExpression(spread) ? spread : (bound ?? heldObjectOf(spread));
      const found = inner === undefined ? undefined : valueIn(inner, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return valueIn(entry.object, 0);
};

const sameBindings =(a: Bindings | undefined, b: Bindings | undefined): boolean => {
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

/** The methods of a list that hand back the entries a test keeps: `routes.filter((route) => route.area === area)`. */
const KEEPING_METHODS: ReadonlySet<string> = new Set(['filter', 'find']);

/** Whether a node is written in a library, not the repository. */
const inLibrary = (node: TsNode): boolean => node.getSourceFile().isDeclarationFile() || node.getSourceFile().getFilePath().includes('/node_modules/');

/** The declaration a name or a member read names, through an import. */
const declarationOf = (node: TsNode): TsNode | undefined => {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
};

/**
 * The expression a store is reached through, past the ways an entry of it is
 * read: `this.plugins` of `this.plugins.get(type)!`, `routes` of `(routes[area]
 * ??= [])`. What a store is, is asked of this root.
 */
const storeRoot = (node: TsNode): TsNode => {
  let at = bare(node);
  for (;;) {
    const callee = Node.isCallExpression(at) ? at.getExpression() : undefined;
    if (callee !== undefined && Node.isPropertyAccessExpression(callee) && callee.getName() === 'get') at = bare(callee.getExpression());
    else if (Node.isElementAccessExpression(at)) at = bare(at.getExpression());
    else if (Node.isBinaryExpression(at) && ['??=', '||='].includes(at.getOperatorToken().getText())) at = bare(at.getLeft());
    else return at;
  }
};

/** Whether an expression is the store, as seen from inside one function: its root is it. */
type StoreTest = (root: TsNode) => boolean;

/** A function that may add to a store: how the store is seen inside it, and the parameter it is handed in by, where it is (P303). */
interface Adder {
  readonly fn: TsNode;
  readonly isStore: StoreTest;
  readonly storeParameter?: number;
}

/** What a function adding to a store does: the key it files an entry under (`plugin.type`) where it reads one, and the parameter the entry comes in by. */
interface Storing {
  readonly key?: string;
  readonly entry?: number;
}

const parametersOf = (fn: TsNode): readonly ParameterDeclaration[] =>
  Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) ? fn.getParameters() : [];

/** The parameter of a function a name reads, by its place. */
const parameterIndex = (fn: TsNode, node: TsNode): number | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  const at = parametersOf(fn).findIndex((parameter) => declarations.includes(parameter as never));
  return at === -1 ? undefined : at;
};

/** The parameter `place` of a function, as a store handed in by it (P303). */
const parameterStore =
  (fn: TsNode, place: number): StoreTest =>
  (root) =>
    parameterIndex(fn, root) === place;

/**
 * Whether a function adds to a store, itself or through the functions it
 * calls that do (`calls` says which, and how the store is seen in each);
 * the key it files an entry under where it reads one (`this.plugins.get(
 * plugin.type)`, `routes[route.area]`), and the parameter the entry comes in
 * by: the one the key is read off, or the one handed to what adds.
 */
const storing = (adder: Adder, calls: (call: TsNode, adder: Adder) => readonly Adder[], depth = 0): Storing | undefined => {
  if (depth > 3) return undefined;
  let stores = false;
  let key: string | undefined;
  let keyEntry: number | undefined;
  const handed: number[] = [];
  const noteEntry = (value: TsNode): void => {
    for (const each of [value, ...value.getDescendantsOfKind(SyntaxKind.Identifier)]) {
      const at = parameterIndex(adder.fn, each);
      if (at !== undefined && at !== adder.storeParameter && !handed.includes(at)) handed.push(at);
    }
  };
  // `plugin.type` read as the key an entry is filed under.
  const noteKey = (index: TsNode | undefined): void => {
    if (index === undefined || !Node.isPropertyAccessExpression(index) || !Node.isIdentifier(index.getExpression())) return;
    key ??= index.getName();
    keyEntry ??= parameterIndex(adder.fn, index.getExpression());
  };
  adder.fn.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && adder.isStore(storeRoot(callee.getExpression()))) {
        if (STORING_METHODS.has(callee.getName())) {
          stores = true;
          for (const argument of node.getArguments()) noteEntry(argument);
        }
        if (callee.getName() === 'get') noteKey(node.getArguments()[0]);
      }
      for (const inner of calls(node, adder)) {
        if (inner.fn === adder.fn) continue;
        const found = storing(inner, calls, depth + 1);
        if (found === undefined) continue;
        stores = true;
        key ??= found.key;
        const argument = found.entry === undefined ? undefined : node.getArguments()[found.entry];
        if (argument !== undefined) noteEntry(argument);
      }
    }
    if (Node.isElementAccessExpression(node) && adder.isStore(storeRoot(node.getExpression()))) noteKey(node.getArgumentExpression());
    const assigned = Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '=' ? node : undefined;
    const left = assigned?.getLeft();
    if (assigned !== undefined && left !== undefined && Node.isElementAccessExpression(left) && adder.isStore(storeRoot(left.getExpression()))) {
      stores = true;
      noteEntry(assigned.getRight());
    }
  });
  if (!stores) return undefined;
  const entry = keyEntry ?? handed[0];
  return { ...(key === undefined ? {} : { key }), ...(entry === undefined ? {} : { entry }) };
};

/**
 * How the function reading a store looks an entry up: by its parameter
 * (`this.plugins.get(type)`, `routes[area]`), or by a test on a key of each
 * entry (`routes.filter((route) => route.area === area)`, which names the
 * key itself).
 */
const readKeyOf = (reader: TsNode, isStore: StoreTest): { readonly parameter: number; readonly key?: string } | undefined => {
  let found: { parameter: number; key?: string } | undefined;
  reader.forEachDescendant((node, traversal) => {
    let index: TsNode | undefined;
    let key: string | undefined;
    const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (Node.isCallExpression(node) && callee !== undefined && Node.isPropertyAccessExpression(callee) && isStore(storeRoot(callee.getExpression()))) {
      if (callee.getName() === 'get') index = node.getArguments()[0];
      const test = KEEPING_METHODS.has(callee.getName()) ? node.getArguments()[0] : undefined;
      const fn = test === undefined ? undefined : bare(test);
      if (fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) {
        const [entry] = fn.getParameters();
        for (const compared of fn.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
          if (!['===', '=='].includes(compared.getOperatorToken().getText())) continue;
          for (const [side, other] of [
            [compared.getLeft(), compared.getRight()],
            [compared.getRight(), compared.getLeft()],
          ] as const) {
            const read = bare(side);
            if (entry === undefined || !Node.isPropertyAccessExpression(read) || parameterIndex(fn, bare(read.getExpression())) !== 0 || parameterIndex(reader, bare(other)) === undefined) continue;
            index = bare(other);
            key = read.getName();
          }
        }
      }
    } else if (Node.isElementAccessExpression(node) && isStore(storeRoot(node.getExpression()))) index = node.getArgumentExpression();
    const parameter = index === undefined ? undefined : parameterIndex(reader, bare(index));
    if (parameter === undefined) return;
    found = { parameter, ...(key === undefined ? {} : { key }) };
    traversal.stop();
  });
  return found;
};

/** A class of the repository a receiver names, and the `const` holding an instance of it where it names one. */
const registryClassOf = (receiver: TsNode): { readonly cls: ClassDeclaration; readonly instance?: TsNode } | undefined => {
  if (!Node.isIdentifier(receiver)) return undefined;
  const declaration = declarationOf(receiver);
  if (declaration === undefined || inLibrary(declaration)) return undefined;
  if (Node.isClassDeclaration(declaration)) return { cls: declaration };
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const made = declaration.getInitializer();
  const created = made === undefined ? undefined : bare(made);
  if (created === undefined || !Node.isNewExpression(created)) return undefined;
  const found = registryClassOf(created.getExpression());
  return found === undefined || found.instance !== undefined ? undefined : { cls: found.cls, instance: declaration };
};

/** Whether an expression is `this` or the class's own name: what a field of the class is read off. */
const isOwner = (node: TsNode, cls: ClassDeclaration): boolean => Node.isThisExpression(node) || (Node.isIdentifier(node) && node.getText() === cls.getName());

/** The fields of a class a method reads: `this.plugins`, `Registry.plugins`. */
const fieldsReadBy = (cls: ClassDeclaration, method: MethodDeclaration): Set<string> => {
  const fields = new Set<string>();
  method.forEachDescendant((node) => {
    if (!Node.isPropertyAccessExpression(node) || !isOwner(node.getExpression(), cls)) return;
    if (cls.getProperty(node.getName()) !== undefined || cls.getStaticProperty(node.getName()) !== undefined) fields.add(node.getName());
  });
  return fields;
};

/** The object literal a name holds where it is a `const` of the repository written with one. */
const heldObjectOf = (name: TsNode): ObjectLiteralExpression | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const declaration = declarationOf(name);
  if (declaration === undefined || inLibrary(declaration) || !Node.isVariableDeclaration(declaration)) return undefined;
  const value = declaration.getInitializer();
  const object = value === undefined ? undefined : bare(value);
  return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
};

/** The function an object written in place holds under a key: a method, or an arrow or a function expression. */
const memberFunction = (holder: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = holder.getProperty(key);
  if (property !== undefined && Node.isMethodDeclaration(property) && property.getBody() !== undefined) return property;
  const value = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  const fn = value === undefined ? undefined : bare(value);
  return fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn : undefined;
};

/** A function of the repository a callee names - a function, a `const` holding one, or one an object `const` holds - with that object (P303). */
const ownFunctionOf = (callee: TsNode): { readonly fn: TsNode; readonly holder?: ObjectLiteralExpression } | undefined => {
  const name = bare(callee);
  if (Node.isIdentifier(name)) {
    const fn = calledFunction(name);
    return fn === undefined || inLibrary(fn) ? undefined : { fn };
  }
  if (!Node.isPropertyAccessExpression(name)) return undefined;
  const holder = heldObjectOf(bare(name.getExpression()));
  const fn = holder === undefined ? undefined : memberFunction(holder, name.getName());
  return fn === undefined || holder === undefined ? undefined : { fn, holder };
};

/** The functions written beside one at the top of its module, and those the object holding it holds (P303). */
const functionsBeside = (fn: TsNode, holder: ObjectLiteralExpression | undefined): Set<TsNode> => {
  const found = new Set<TsNode>();
  for (const statement of fn.getSourceFile().getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.getBody() !== undefined) found.add(statement);
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      const value = declaration.getInitializer();
      const held = value === undefined ? undefined : bare(value);
      if (held !== undefined && (Node.isArrowFunction(held) || Node.isFunctionExpression(held))) found.add(held);
    }
  }
  for (const property of holder?.getProperties() ?? []) {
    const name = Node.isMethodDeclaration(property) || Node.isPropertyAssignment(property) ? property.getName() : undefined;
    const member = name === undefined ? undefined : memberFunction(holder as ObjectLiteralExpression, name);
    if (member !== undefined) found.add(member);
  }
  return found;
};

/** Whether a declaration is a variable written at the top of a module of the repository, holding no function: a store a module keeps (P303). */
const isModuleStore = (declaration: TsNode | undefined): declaration is VariableDeclaration => {
  if (declaration === undefined || !Node.isVariableDeclaration(declaration) || inLibrary(declaration)) return false;
  if (!Node.isSourceFile(declaration.getVariableStatement()?.getParent())) return false;
  const value = declaration.getInitializer();
  const held = value === undefined ? undefined : bare(value);
  if (held !== undefined && (Node.isArrowFunction(held) || Node.isFunctionExpression(held))) return false;
  // An object holding functions is a module of them, not a store.
  return held === undefined || !Node.isObjectLiteralExpression(held) || held.getProperties().every((property) => !Node.isMethodDeclaration(property) && memberFunction(held, Node.isPropertyAssignment(property) ? property.getName() : '') === undefined);
};

/** The entries a registry's own function writes into its store in place: `routes.push({ path })`, `routes.set(key, { path })`, `routes[key] = { path }`. */
const writtenIn = (fn: TsNode, isStore: StoreTest): TsNode[] => {
  const found: TsNode[] = [];
  const objects = (values: readonly TsNode[]): TsNode[] => values.filter((value) => Node.isObjectLiteralExpression(bare(value)));
  fn.forEachDescendant((node) => {
    const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (Node.isCallExpression(node) && callee !== undefined && Node.isPropertyAccessExpression(callee) && STORING_METHODS.has(callee.getName()) && isStore(storeRoot(callee.getExpression()))) {
      const args = node.getArguments();
      found.push(...objects(callee.getName() === 'set' ? args.slice(-1) : callee.getName() === 'splice' ? args.slice(2) : args));
    }
    const left = Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '=' ? node.getLeft() : undefined;
    if (left !== undefined && Node.isBinaryExpression(node) && Node.isElementAccessExpression(left) && isStore(storeRoot(left.getExpression()))) found.push(...objects([node.getRight()]));
  });
  return found;
};

/** Whether a node is written as a function: a declaration, an arrow, a function expression or a method. */
const isFunctionNode = (node: TsNode): boolean =>
  Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isMethodDeclaration(node) || Node.isConstructorDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node);

/** The values a statement written outside any function adds to a store: `routes.set(key, route)`, `routes.push(route)`, `routes[key] = route`. */
const addedAtTop = (statement: TsNode, isStore: StoreTest): TsNode[] => {
  const found: TsNode[] = [];
  statement.forEachDescendant((node, traversal) => {
    if (isFunctionNode(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (Node.isCallExpression(node) && callee !== undefined && Node.isPropertyAccessExpression(callee) && STORING_METHODS.has(callee.getName()) && isStore(storeRoot(callee.getExpression()))) {
      const args = node.getArguments();
      found.push(...(callee.getName() === 'set' ? args.slice(-1) : callee.getName() === 'splice' ? args.slice(2) : args));
    }
    const left = Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '=' ? node.getLeft() : undefined;
    if (left !== undefined && Node.isBinaryExpression(node) && Node.isElementAccessExpression(left) && isStore(storeRoot(left.getExpression()))) found.push(node.getRight());
  });
  return found;
};

/** Where a store a module keeps is reached from across the repository: the functions written at the top of a module that name it, and what statements outside any function add to it (P314). */
interface StoreReach {
  readonly functions: readonly TsNode[];
  readonly added: readonly TsNode[];
}

const REACHES = new WeakMap<TsNode, StoreReach>();

/** The function at the top of a module a node is written in - the outermost one, so a callback inside it is its own - or nothing outside any function. */
const outermostFunction = (node: TsNode): TsNode | undefined => {
  let found: TsNode | undefined;
  for (let at = node.getParent(); at !== undefined && !Node.isSourceFile(at); at = at.getParent()) if (isFunctionNode(at)) found = at;
  return found;
};

/**
 * Every place the repository names a store a module keeps, found by the
 * checker's references so an import under another name is the same store
 * (P314): the functions naming it, each a function that may add to it, and
 * the values added to it outside any function, in any module.
 */
const storeReach = (declaration: VariableDeclaration): StoreReach => {
  const known = REACHES.get(declaration);
  if (known !== undefined) return known;
  const functions = new Set<TsNode>();
  const statements = new Set<TsNode>();
  const name = declaration.getNameNode();
  let references: TsNode[] = [];
  try {
    references = Node.isIdentifier(name) ? name.findReferencesAsNodes() : [];
  } catch {
    references = [];
  }
  for (const reference of references) {
    if (reference === name || inLibrary(reference)) continue;
    const fn = outermostFunction(reference);
    if (fn !== undefined) {
      functions.add(fn);
      continue;
    }
    const statement = reference.getFirstAncestor((each) => Node.isSourceFile(each.getParent()));
    if (statement !== undefined && statement !== declaration.getVariableStatement()) statements.add(statement);
  }
  const isStore: StoreTest = (root) => Node.isIdentifier(root) && declarationOf(root) === declaration;
  const reach = { functions: [...functions], added: [...statements].flatMap((statement) => addedAtTop(statement, isStore)) };
  REACHES.set(declaration, reach);
  return reach;
};

/** Whether a store a module keeps is one to look for across the repository: a `Map`, a `Set`, an array or an object made empty or written in place, or a variable given none. */
const isKeptStore = (declaration: VariableDeclaration): boolean => {
  const value = declaration.getInitializer();
  const held = value === undefined ? undefined : bare(value);
  return held === undefined || Node.isNewExpression(held) || Node.isArrayLiteralExpression(held) || Node.isObjectLiteralExpression(held);
};

/** The items written into a store kept under a variable: its array written in place, and what any module adds to it outside a function (P314). */
const writtenInto = (declaration: TsNode): TsNode[] => {
  if (!Node.isVariableDeclaration(declaration)) return [];
  const value = declaration.getInitializer();
  const held = value === undefined ? undefined : bare(value);
  const found: TsNode[] = held !== undefined && Node.isArrayLiteralExpression(held) ? [...held.getElements()] : [];
  return isKeptStore(declaration) ? [...found, ...storeReach(declaration).added] : found;
};

/** The object literal a function written as a member of one is held by. */
const holderOf = (fn: TsNode): ObjectLiteralExpression | undefined => {
  const parent = fn.getParent();
  const holder = parent !== undefined && Node.isPropertyAssignment(parent) ? parent.getParent() : parent;
  return holder !== undefined && Node.isObjectLiteralExpression(holder) ? holder : undefined;
};

/** The expressions a function hands back: its concise body, or each of its own `return`s, whatever kind of function it is. */
const handedBackBy = (fn: TsNode): TsNode[] => {
  if (!isFunctionNode(fn)) return [];
  const body = (fn as unknown as { getBody(): TsNode | undefined }).getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  const found: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (isFunctionNode(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
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

/**
 * What a registry's reader hands back of its store (P314): its entries as
 * they are (`store`, `store.get(key)`, `[...store.values()]`,
 * `Object.values(store)`, a `filter` / `sort` / `slice` of them), each mapped
 * to an object written over the entry (`store.map((route) => ({ ...route,
 * path: base + route.path }))`), or something else made of them, which is not
 * read.
 */
type StoreView =
  | { readonly kind: 'entries' }
  | { readonly kind: 'mapped'; readonly object: ObjectLiteralExpression; readonly parameter: ParameterDeclaration }
  | { readonly kind: 'unread'; readonly why: string };

const ENTRIES: StoreView = { kind: 'entries' };

/** The methods of a list a view of a store passes through keeping its entries as they are. */
const VIEW_KEEPING: ReadonlySet<string> = new Set(['filter', 'find', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'concat', 'values', 'flat']);

/** The object a function handed to `map` writes for each entry, and the entry's name: `(route) => ({ ...route, path })`. */
const mappedBy = (handed: TsNode | undefined): StoreView => {
  const fn = handed === undefined ? undefined : bare(handed);
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return { kind: 'unread', why: 'a function of its own maps each entry' };
  const [parameter] = fn.getParameters();
  const returned = handedBackBy(fn);
  const object = returned.length === 1 ? bare(returned[0] as TsNode) : undefined;
  if (parameter === undefined || !Node.isIdentifier(parameter.getNameNode()) || object === undefined || !Node.isObjectLiteralExpression(object)) return { kind: 'unread', why: 'each entry is mapped to something other than an object written over it' };
  return { kind: 'mapped', object, parameter };
};

/** The view of a store an expression of its reader is, or nothing where it reads no store. */
const viewIn = (node: TsNode, isStore: StoreTest, reader: TsNode, depth = 0): StoreView | undefined => {
  if (depth > 6) return undefined;
  const value = bare(node);
  if (Node.isBinaryExpression(value) && ['??', '||'].includes(value.getOperatorToken().getText())) return viewIn(value.getLeft(), isStore, reader, depth + 1) ?? viewIn(value.getRight(), isStore, reader, depth + 1);
  if (isStore(storeRoot(value))) return ENTRIES;
  if (Node.isArrayLiteralExpression(value)) {
    const [only, ...rest] = value.getElements();
    return only !== undefined && rest.length === 0 && Node.isSpreadElement(only) ? viewIn(only.getExpression(), isStore, reader, depth + 1) : undefined;
  }
  if (Node.isIdentifier(value)) {
    const declaration = declarationOf(value);
    const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getFirstAncestor((each) => each === reader) !== undefined ? declaration.getInitializer() : undefined;
    return initializer === undefined ? undefined : viewIn(initializer, isStore, reader, depth + 1);
  }
  if (!Node.isCallExpression(value)) return undefined;
  const callee = value.getExpression();
  const args = value.getArguments();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const owner = bare(callee.getExpression());
  const name = callee.getName();
  // `Object.values(store)`, `Array.from(store.values(), fn)`: the entries, mapped where a function is handed.
  const global = Node.isIdentifier(owner) && ['Object', 'Array'].includes(owner.getText()) ? declarationOf(owner) : null;
  if (global !== null && (global === undefined || inLibrary(global))) {
    const inner = args[0] === undefined ? undefined : viewIn(args[0], isStore, reader, depth + 1);
    if (inner === undefined) return undefined;
    if (owner.getText() === 'Object' && name === 'values') return inner;
    if (owner.getText() === 'Array' && name === 'from') return args.length < 2 ? inner : inner.kind === 'entries' ? mappedBy(args[1]) : { kind: 'unread', why: 'its entries are mapped twice' };
    return { kind: 'unread', why: `${owner.getText()}.${name}(...) is made of its entries` };
  }
  const inner = viewIn(owner, isStore, reader, depth + 1);
  if (inner === undefined) return undefined;
  if (VIEW_KEEPING.has(name)) return inner;
  if (name === 'map') return inner.kind === 'entries' ? mappedBy(args[0]) : { kind: 'unread', why: 'its entries are mapped twice' };
  return { kind: 'unread', why: `.${name}(...) is made of its entries` };
};

/** What a registry's reader hands back of its store, over all its `return`s: one view, or none read where they differ. */
const viewOf = (reader: TsNode, isStore: StoreTest): StoreView => {
  const views = handedBackBy(reader).flatMap((returned) => [viewIn(returned, isStore, reader)].filter((each): each is StoreView => each !== undefined));
  const [first] = views;
  if (first === undefined) return ENTRIES;
  const unread = views.find((each) => each.kind === 'unread');
  if (unread !== undefined) return unread;
  if (views.every((each) => each.kind === first.kind && (each.kind !== 'mapped' || (first.kind === 'mapped' && each.object === first.object)))) return first;
  return { kind: 'unread', why: 'its returns hand back different views of its entries' };
};

/** Whether two expressions name one store: the same variable, field or parameter, through an import. */
const sameStore = (a: TsNode | undefined, b: TsNode | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  const left = bare(a);
  const right = bare(b);
  if (!(Node.isIdentifier(left) || Node.isPropertyAccessExpression(left)) || !(Node.isIdentifier(right) || Node.isPropertyAccessExpression(right))) return false;
  const declaration = declarationOf(left);
  return declaration !== undefined && declaration === declarationOf(right);
};

/**
 * A registry a list is read off, as one shape whatever keeps its store: the
 * function reading it, the functions adding to it (each with what it does
 * and, for a store handed in, the parameter of each), the adding function a
 * call names, whether a call adds to the store this read reads, and the
 * entries written into the store itself.
 */
interface Registry {
  readonly reader: TsNode;
  readonly isStore: StoreTest;
  readonly adders: ReadonlyMap<TsNode, Storing & { readonly storeParameter?: number }>;
  readonly names: readonly string[];
  readonly adderOf: (call: CallExpression) => TsNode | undefined;
  /** Whether a node is written inside the registry's own functions, where a call handing on what it was handed is how it adds. */
  readonly owns: (node: TsNode) => boolean;
  readonly sameRegistry: (adding: CallExpression, adder: TsNode) => boolean;
  readonly written: readonly TsNode[];
}

/** A registry held by a class of the repository: a method reading a field its other methods add to (P297). */
const classRegistry = (call: CallExpression): Registry | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const owner = registryClassOf(bare(callee.getExpression()));
  if (owner === undefined) return undefined;
  const { cls, instance } = owner;
  const reader = (instance === undefined ? cls.getStaticMethod(callee.getName()) : cls.getInstanceMethod(callee.getName())) as MethodDeclaration | undefined;
  if (reader === undefined || reader.getBody() === undefined) return undefined;
  const fields = fieldsReadBy(cls, reader);
  if (fields.size === 0) return undefined;
  const isStore: StoreTest = (root) => Node.isPropertyAccessExpression(root) && fields.has(root.getName()) && isOwner(root.getExpression(), cls);
  // `this.register(plugin)`: a method of the class it calls on itself.
  const calls = (node: TsNode, adder: Adder): Adder[] => {
    const target = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (target === undefined || !Node.isPropertyAccessExpression(target) || !isOwner(target.getExpression(), cls)) return [];
    const called = cls.getMethods().find((each) => each.getName() === target.getName() && each.getBody() !== undefined);
    return called === undefined ? [] : [{ fn: called, isStore: adder.isStore }];
  };
  const adders = new Map<TsNode, Storing>();
  for (const method of cls.getMethods()) {
    if (method === reader || method.isStatic() !== (instance === undefined) || method.getBody() === undefined) continue;
    const stores = storing({ fn: method, isStore }, calls);
    if (stores !== undefined) adders.set(method, stores);
  }
  return {
    reader,
    isStore,
    adders,
    names: [...adders.keys()].map((method) => (method as MethodDeclaration).getName()),
    adderOf: (adding) => {
      const target = adding.getExpression();
      if (!Node.isPropertyAccessExpression(target)) return undefined;
      const receiver = bare(target.getExpression());
      const within = adding.getFirstAncestor((node) => node === cls) !== undefined;
      if (Node.isThisExpression(receiver)) {
        if (!within) return undefined;
      } else if (!(within && isOwner(receiver, cls))) {
        const added = registryClassOf(receiver);
        if (added === undefined || added.cls !== cls || added.instance !== instance) return undefined;
      }
      return [...adders.keys()].find((method) => (method as MethodDeclaration).getName() === target.getName());
    },
    owns: (node) => node.getFirstAncestor((each) => each === cls) !== undefined,
    sameRegistry: () => true,
    written: [...adders.keys()].flatMap((method) => writtenIn(method, isStore)),
  };
};

/**
 * A registry kept by functions (P303): a function of the repository - or a
 * method an object `const` holds - reading a store the functions beside it
 * add to, the store a variable at the top of a module (`const routes = new
 * Map()`, `[]`, `{}`), a field of the object holding them (`this.items`), or
 * one handed in (`routesOf(store, area)` and `addRoute(store, route)`, the
 * same store named at both calls).
 */
const functionRegistry = (call: CallExpression): Registry | undefined => {
  const own = ownFunctionOf(call.getExpression());
  if (own === undefined) return undefined;
  const { fn: reader, holder } = own;
  const modules = new Set<VariableDeclaration>();
  reader.forEachDescendant((node) => {
    if (!Node.isIdentifier(node)) return;
    const declaration = declarationOf(node);
    if (isModuleStore(declaration)) modules.add(declaration);
  });
  // The functions beside the reader, and those of any module naming a store it reads, with the ones beside each (P314).
  const beside = functionsBeside(reader, holder);
  let addedOutside = false;
  for (const store of modules) {
    if (!isKeptStore(store)) continue;
    const reach = storeReach(store);
    if (reach.added.length > 0) addedOutside = true;
    for (const fn of reach.functions) {
      if (fn === reader) continue;
      beside.add(fn);
      for (const other of functionsBeside(fn, holderOf(fn))) beside.add(other);
    }
  }
  beside.delete(reader);
  if (beside.size === 0 && !addedOutside) return undefined;
  const fields = new Set<string>();
  for (const property of holder?.getProperties() ?? []) {
    if (Node.isPropertyAssignment(property) && memberFunction(holder as ObjectLiteralExpression, property.getName()) === undefined) fields.add(property.getName());
  }
  const fixed: StoreTest = (root) =>
    (Node.isIdentifier(root) && modules.has(declarationOf(root) as VariableDeclaration)) ||
    (Node.isPropertyAccessExpression(root) && Node.isThisExpression(root.getExpression()) && fields.has(root.getName()) && root.getFirstAncestor((each) => each === holder) !== undefined);
  // A parameter of the reader its store is handed in by: one it reads entries off, or hands back.
  const handedIn = parametersOf(reader).flatMap((_, place) => {
    const isStore = parameterStore(reader, place);
    let read = false;
    reader.forEachDescendant((node, traversal) => {
      const parent = node.getParent();
      if (!isStore(node) || parent === undefined) return;
      if ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) && parent.getExpression() === node) read = true;
      if (Node.isReturnStatement(parent) || Node.isSpreadElement(parent) || Node.isArrowFunction(parent)) read = true;
      if (read) traversal.stop();
    });
    return read ? [place] : [];
  });
  /** A function beside the reader a call names: `register(route)`, `this.register(route)`. */
  const besideCalled = (node: TsNode, from: TsNode): TsNode | undefined => {
    if (!Node.isCallExpression(node)) return undefined;
    const callee = node.getExpression();
    // `this.register(route)` in a member of an object: the object's own member, the reader's or another module's (P314).
    const held = from === reader ? holder : (holderOf(from) ?? holder);
    if (held !== undefined && Node.isPropertyAccessExpression(callee) && Node.isThisExpression(callee.getExpression())) return memberFunction(held, callee.getName());
    const found = ownFunctionOf(callee)?.fn;
    return found !== undefined && (beside.has(found) || found === reader) ? found : undefined;
  };
  const calls = (node: TsNode, adder: Adder): Adder[] => {
    const called = besideCalled(node, adder.fn);
    if (called === undefined || !Node.isCallExpression(node)) return [];
    if (adder.storeParameter === undefined) return [{ fn: called, isStore: adder.isStore }];
    // A store handed on: the parameter of the function called it is handed to.
    return node.getArguments().flatMap((argument, place) => (adder.isStore(storeRoot(argument)) ? [{ fn: called, isStore: parameterStore(called, place), storeParameter: place }] : []));
  };
  const adders = new Map<TsNode, Storing & { readonly storeParameter?: number; readonly readerParameter?: number }>();
  for (const fn of beside) {
    if (modules.size > 0 || fields.size > 0) {
      const stores = storing({ fn, isStore: fixed }, calls);
      if (stores !== undefined) {
        adders.set(fn, stores);
        continue;
      }
    }
    for (const readerParameter of handedIn) {
      const place = parametersOf(fn).findIndex((_, at) => storing({ fn, isStore: parameterStore(fn, at), storeParameter: at }, calls) !== undefined);
      if (place === -1) continue;
      const stores = storing({ fn, isStore: parameterStore(fn, place), storeParameter: place }, calls) as Storing;
      adders.set(fn, { ...stores, storeParameter: place, readerParameter });
      break;
    }
  }
  if (adders.size === 0 && !addedOutside) return undefined;
  const nameOf = (fn: TsNode): string | undefined => {
    if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getName();
    const parent = fn.getParent();
    return parent !== undefined && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) ? parent.getName() : undefined;
  };
  // What is written into the store itself: a module's array and what it pushes outside any function, and the array a handed store names.
  const handedStore = (place: number | undefined): TsNode | undefined => {
    const argument = place === undefined ? undefined : call.getArguments()[place];
    const named = argument === undefined ? undefined : bare(argument);
    return named !== undefined && Node.isIdentifier(named) ? declarationOf(named) : undefined;
  };
  const readerParameters = new Set([...adders.values()].flatMap((each) => (each.readerParameter === undefined ? [] : [each.readerParameter])));
  const isStore: StoreTest = (root) => fixed(root) || handedIn.some((place) => parameterStore(reader, place)(root));
  const written = [
    ...[...modules, ...[...readerParameters].flatMap((place) => [handedStore(place)].filter((each): each is TsNode => each !== undefined && isModuleStore(each)))].flatMap(writtenInto),
    ...[...adders].flatMap(([fn, each]) => writtenIn(fn, each.storeParameter === undefined ? fixed : parameterStore(fn, each.storeParameter))),
  ];
  return {
    reader,
    isStore,
    adders,
    names: [...adders.keys()].flatMap((fn) => [nameOf(fn)].filter((name): name is string => name !== undefined)),
    adderOf: (adding) => {
      const target = adding.getExpression();
      const found =
        holder !== undefined && Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression()) ? memberFunction(holder, target.getName()) : ownFunctionOf(target)?.fn;
      return found !== undefined && adders.has(found) ? found : undefined;
    },
    owns: (node) => node.getFirstAncestor((each) => beside.has(each) || each === reader) !== undefined,
    sameRegistry: (adding, adder) => {
      const each = adders.get(adder);
      if (each?.storeParameter === undefined || each.readerParameter === undefined) return true;
      return sameStore(adding.getArguments()[each.storeParameter], call.getArguments()[each.readerParameter]);
    },
    written,
  };
};

/** The entries a registry holds as its reader hands them back: the entries, the view of them it hands back (P314), and how many are not read. */
interface RegistryRead {
  readonly items: readonly TsNode[];
  readonly unread: number;
  readonly view: StoreView;
}

const REGISTRIES = new WeakMap<TsNode, RegistryRead | null>();

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
 * its adding calls on that `const`. A store kept by functions is read the
 * same way (P303): a module's `Map`, array or object the functions beside
 * the reader add to, a field of the object holding them, or a store handed
 * to both; an entry is the argument the adding function files, and a test
 * on a key (`routes.filter((route) => route.area === area)`) looks entries up
 * as `get` does. A module's store is followed wherever the repository names
 * it (P314): the functions of any module adding to it, and what any module
 * adds to it outside a function. What the reader hands back of the store is
 * read too (P314): its entries as they are, each mapped to an object written
 * over the entry, or a view made of them otherwise, which is not read.
 */
const registryEntries = (call: TsNode): RegistryRead | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const known = REGISTRIES.get(call);
  if (known !== undefined) return known ?? undefined;
  REGISTRIES.set(call, null);
  const registry = classRegistry(call) ?? functionRegistry(call);
  if (registry === undefined || (registry.adders.size === 0 && registry.written.length === 0)) return undefined;
  const readKey = readKeyOf(registry.reader, registry.isStore);
  const keyArgument = readKey === undefined ? undefined : call.getArguments()[readKey.parameter];
  const items: TsNode[] = [];
  let unread = 0;
  const matches = (item: TsNode, filed: string | undefined): boolean => {
    const key = readKey?.key ?? filed;
    if (key === undefined || keyArgument === undefined) return true;
    const object = heldObjectOf(bare(item)) ?? bare(item);
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
  const take = (handed: readonly TsNode[], filed: string | undefined): void => {
    for (const each of handed) {
      if (items.length >= MOST) break;
      // An object written in place, a spread, or a `const` holding an object (P314).
      if (!Node.isObjectLiteralExpression(bare(each)) && !Node.isSpreadElement(each) && heldObjectOf(bare(each)) === undefined) {
        unread += 1;
        continue;
      }
      if (matches(each, filed)) items.push(each);
    }
  };
  const filedKeys = [...new Set([...registry.adders.values()].map((each) => each.key))];
  take(registry.written, filedKeys.length === 1 ? filedKeys[0] : undefined);
  for (const source of call.getSourceFile().getProject().getSourceFiles()) {
    if (inLibrary(source)) continue;
    const text = source.getFullText();
    if (!registry.names.some((name) => text.includes(`${name}(`))) continue;
    for (const adding of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const adder = registry.adderOf(adding);
      const stores = adder === undefined ? undefined : registry.adders.get(adder);
      if (adder === undefined || stores === undefined || !registry.sameRegistry(adding, adder)) continue;
      const place = stores.entry ?? (stores.storeParameter === 0 ? 1 : 0);
      const argument = adding.getArguments()[place];
      if (argument === undefined) continue;
      const value = bare(argument);
      // `this.register(plugin)` inside the registry: what it was handed, counted where it is handed.
      const named = Node.isIdentifier(value) ? value.getSymbol()?.getDeclarations()[0] : undefined;
      if (registry.owns(adding) && named !== undefined && Node.isParameterDeclaration(named)) continue;
      take(Node.isArrayLiteralExpression(value) ? value.getElements() : [value], stores.key);
    }
  }
  const read = { items, unread, view: viewOf(registry.reader, registry.isStore) };
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
      const { view } = registered;
      // A view of the entries made otherwise than by mapping each to an object over it: none is read (P314).
      if (view.kind === 'unread') {
        unread += registered.items.length + registered.unread;
        return true;
      }
      const from = entries.length;
      for (const each of registered.items) item(each, depth + 1);
      // Each entry mapped to an object written over it: that object, the entry bound to the function's parameter (P314).
      if (view.kind === 'mapped') for (const entry of entries.splice(from)) push({ object: view.object, bound: new Map([...(entry.bound ?? []), [view.parameter, entry.object]]) });
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
