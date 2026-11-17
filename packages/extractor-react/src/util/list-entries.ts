import { evaluateExpression } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, MethodDeclaration, NewExpression, Node as TsNode, ObjectLiteralExpression, ParameterDeclaration, PropertyDeclaration, VariableDeclaration } from 'ts-morph';
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
  /** Why the items not read are not, each said once (P320). */
  readonly why: readonly string[];
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
  Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) || Node.isConstructorDeclaration(fn) ? fn.getParameters() : [];

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

/**
 * What a receiver may hold of a class of the repository (P326): the class
 * itself, or an instance - the `const` holding a `new` of it, or a `new`
 * written in place. One instance is the same wherever it is named.
 */
type Held = ClassDeclaration | VariableDeclaration | NewExpression;

/** The class of the repository a `new` makes. */
const classMade = (made: NewExpression): ClassDeclaration | undefined => {
  const name = bare(made.getExpression());
  const declaration = Node.isIdentifier(name) ? declarationOf(name) : undefined;
  return declaration !== undefined && Node.isClassDeclaration(declaration) && !inLibrary(declaration) ? declaration : undefined;
};

/** The class a held value is, or is an instance of. */
const classOfHeld = (held: Held): ClassDeclaration | undefined => {
  if (Node.isClassDeclaration(held)) return held;
  if (Node.isNewExpression(held)) return classMade(held);
  const value = held.getInitializer();
  const made = value === undefined ? undefined : bare(value);
  return made !== undefined && Node.isNewExpression(made) ? classMade(made) : undefined;
};

/** The `new` an instance is made by. */
const newOf = (held: Held): NewExpression | undefined => {
  if (Node.isNewExpression(held)) return held;
  if (!Node.isVariableDeclaration(held)) return undefined;
  const value = held.getInitializer();
  const made = value === undefined ? undefined : bare(value);
  return made !== undefined && Node.isNewExpression(made) ? made : undefined;
};

const CALLS = new WeakMap<TsNode, readonly (CallExpression | NewExpression)[]>();

/** Every call of a function of the repository, by its name through the checker's references; a constructor's are its class's `new`s (P326). */
const callsOf = (fn: TsNode): readonly (CallExpression | NewExpression)[] => {
  const known = CALLS.get(fn);
  if (known !== undefined) return known;
  const parent = fn.getParent();
  const name = Node.isConstructorDeclaration(fn)
    ? Node.isClassDeclaration(parent) ? parent.getNameNode() : undefined
    : Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)
      ? fn.getNameNode()
      : parent !== undefined && Node.isVariableDeclaration(parent)
        ? parent.getNameNode()
        : undefined;
  let references: TsNode[] = [];
  try {
    references = name !== undefined && Node.isIdentifier(name) ? name.findReferencesAsNodes() : [];
  } catch {
    references = [];
  }
  const found: (CallExpression | NewExpression)[] = [];
  for (const reference of references) {
    if (inLibrary(reference)) continue;
    const named = reference.getParent();
    const callee = named !== undefined && Node.isPropertyAccessExpression(named) && named.getNameNode() === reference ? named : reference;
    const call = callee.getParent();
    if (call === undefined || !(Node.isCallExpression(call) || Node.isNewExpression(call)) || call.getExpression() !== callee) continue;
    if (Node.isNewExpression(call) !== Node.isConstructorDeclaration(fn)) continue;
    found.push(call);
  }
  CALLS.set(fn, found);
  return found;
};

const HELD = new WeakMap<TsNode, readonly Held[] | null>();

/**
 * What a receiver holds (P326): a class or the `const` holding an instance
 * (as before), through an import or another `const`, or a static field
 * written with one; a parameter, what every
 * call hands it there; a field of the class `this` is in - a parameter
 * property or one its initializer or a `this.field = value` writes - what is
 * written into it, a constructor's parameter what each `new` of the class
 * hands, or only what `self`'s `new` hands where the instance is known.
 * Nothing where any of these is not read.
 */
const heldBy = (receiver: TsNode, self?: Held, depth = 0): readonly Held[] | undefined => {
  if (depth > 6) return undefined;
  const value = bare(receiver);
  if (Node.isNewExpression(value)) return classMade(value) === undefined ? undefined : [value];
  // A name, a field off `this`, or a static field off its class (`Panels.shared`).
  const declaration = Node.isIdentifier(value) || Node.isPropertyAccessExpression(value) ? declarationOf(value) : undefined;
  if (declaration === undefined || inLibrary(declaration)) return undefined;
  if (Node.isPropertyAccessExpression(value) && !Node.isThisExpression(bare(value.getExpression())) && !(Node.isPropertyDeclaration(declaration) && declaration.isStatic())) return undefined;
  if (self === undefined) {
    const known = HELD.get(declaration);
    if (known !== undefined) return known ?? undefined;
    HELD.set(declaration, null);
  }
  const found = heldIn(declaration, self, depth);
  if (self === undefined) HELD.set(declaration, found ?? null);
  return found;
};

/** What each value may hold, together; nothing where one is not read. */
const heldByAll = (values: readonly (TsNode | undefined)[], self: Held | undefined, depth: number): readonly Held[] | undefined => {
  const found = new Set<Held>();
  for (const value of values) {
    const each = value === undefined ? undefined : heldBy(value, self, depth + 1);
    if (each === undefined) return undefined;
    for (const held of each) found.add(held);
  }
  return found.size === 0 ? undefined : [...found];
};

const heldIn = (declaration: TsNode, self: Held | undefined, depth: number): readonly Held[] | undefined => {
  if (Node.isClassDeclaration(declaration)) return [declaration];
  if (Node.isVariableDeclaration(declaration)) {
    const value = declaration.getInitializer();
    const made = value === undefined ? undefined : bare(value);
    if (made !== undefined && Node.isNewExpression(made)) return classMade(made) === undefined ? undefined : [declaration];
    return made === undefined ? undefined : heldBy(made, self, depth + 1);
  }
  if (Node.isParameterDeclaration(declaration)) {
    const fn = declaration.getParent();
    const place = parametersOf(fn).indexOf(declaration);
    if (Node.isConstructorDeclaration(fn)) {
      // The instance known: what its own `new` hands; else what every `new` of the class does.
      const made = self === undefined ? undefined : newOf(self);
      const calls = made !== undefined && classMade(made) === fn.getParent() ? [made] : callsOf(fn);
      return heldByAll(calls.map((call) => call.getArguments()[place]), undefined, depth);
    }
    if (place === -1 || declaration.getDotDotDotToken() !== undefined) return undefined;
    return heldByAll(callsOf(fn).map((call) => call.getArguments()[place]), undefined, depth);
  }
  if (Node.isPropertyDeclaration(declaration) && !declaration.isStatic()) {
    const cls = declaration.getParent();
    if (!Node.isClassDeclaration(cls)) return undefined;
    const written: TsNode[] = [];
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) written.push(initializer);
    for (const assigned of cls.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = bare(assigned.getLeft());
      if (assigned.getOperatorToken().getText() !== '=' || !Node.isPropertyAccessExpression(left) || !Node.isThisExpression(bare(left.getExpression()))) continue;
      if (declarationOf(left) === declaration) written.push(assigned.getRight());
    }
    return written.length === 0 ? undefined : heldByAll(written, self, depth);
  }
  if (Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer === undefined ? undefined : heldBy(initializer, undefined, depth + 1);
  }
  return undefined;
};

/** Whether a receiver holds a given class or instance, among what it may hold (P326). */
const holds = (receiver: TsNode, held: Held, self?: Held): boolean => heldBy(receiver, self)?.includes(held) === true;

/**
 * A class of the repository a receiver names, and the instance it holds
 * where it holds one: a `const` holding a `new` of it (P297), or one reached
 * through a parameter, a field of another class or an import (P326). A
 * receiver that may hold several instances names none.
 */
const registryClassOf = (receiver: TsNode): { readonly cls: ClassDeclaration; readonly instance?: Held } | undefined => {
  const held = heldBy(receiver);
  const [first] = held ?? [];
  if (held === undefined || first === undefined || new Set(held.map(classOfHeld)).size !== 1) return undefined;
  const cls = classOfHeld(first);
  if (cls === undefined) return undefined;
  if (held.every((each) => Node.isClassDeclaration(each))) return { cls };
  return held.length === 1 ? { cls, instance: first } : undefined;
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

/** What holds a registry's functions as its members: an object written in place, or a class of the repository (P320). */
type Holder = ObjectLiteralExpression | ClassDeclaration;

/** The function an object written in place holds under a key - a method, or an arrow or a function expression - or a class's method of that name (P320). */
const memberFunction = (holder: Holder, key: string): TsNode | undefined => {
  if (Node.isClassDeclaration(holder)) return holder.getMethods().find((method) => method.getName() === key && method.getBody() !== undefined);
  const property = holder.getProperty(key);
  if (property !== undefined && Node.isMethodDeclaration(property) && property.getBody() !== undefined) return property;
  const value = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  const fn = value === undefined ? undefined : bare(value);
  return fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn : undefined;
};

/**
 * A function of the repository a callee names - a function, a `const`
 * holding one, or one an object `const` holds - with that object (P303); or
 * a method of a class of the repository, static on the class (`Pages.add`)
 * or on an instance a `const` holds (`catalog.add`), with that class (P320).
 */
const ownFunctionOf = (callee: TsNode): { readonly fn: TsNode; readonly holder?: Holder } | undefined => {
  const name = bare(callee);
  if (Node.isIdentifier(name)) {
    const fn = calledFunction(name);
    return fn === undefined || inLibrary(fn) ? undefined : { fn };
  }
  if (!Node.isPropertyAccessExpression(name)) return undefined;
  const receiver = bare(name.getExpression());
  const holder = heldObjectOf(receiver);
  if (holder !== undefined) {
    const fn = memberFunction(holder, name.getName());
    return fn === undefined ? undefined : { fn, holder };
  }
  // The class, or instances of one class however many: a parameter handed several, a field (P326).
  const held = heldBy(receiver);
  const classes = new Set(held?.map(classOfHeld));
  const [cls] = classes;
  if (held === undefined || classes.size !== 1 || cls === undefined) return undefined;
  const statics = held.every((each) => Node.isClassDeclaration(each));
  if (!statics && held.some((each) => Node.isClassDeclaration(each))) return undefined;
  const method = statics ? cls.getStaticMethod(name.getName()) : cls.getInstanceMethod(name.getName());
  return method === undefined || method.getBody() === undefined ? undefined : { fn: method, holder: cls };
};

/** The functions written beside one at the top of its module, and those the object or the class holding it holds (P303, P320). */
const functionsBeside = (fn: TsNode, holder: Holder | undefined): Set<TsNode> => {
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
  if (holder !== undefined && Node.isClassDeclaration(holder)) for (const method of holder.getMethods()) if (method.getBody() !== undefined) found.add(method);
  if (holder !== undefined && Node.isObjectLiteralExpression(holder)) {
    for (const property of holder.getProperties()) {
      const name = Node.isMethodDeclaration(property) || Node.isPropertyAssignment(property) ? property.getName() : undefined;
      const member = name === undefined ? undefined : memberFunction(holder, name);
      if (member !== undefined) found.add(member);
    }
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

/** Where a store is reached from across the repository: the functions written at the top of a module that name it, and what statements outside any function add to it (P314). */
interface StoreReach {
  readonly functions: readonly TsNode[];
  readonly added: readonly TsNode[];
  /** How the store is named wherever it is reached: by its declaration, through an import, and off the instance it is a field of. */
  readonly isStore: StoreTest;
}

/** A store kept under a name of the repository: a variable at the top of a module, or a field of a class (P320). */
type StoreDeclaration = VariableDeclaration | PropertyDeclaration;

const REACHES = new WeakMap<TsNode, Map<TsNode, StoreReach>>();

/** The function at the top of a module a node is written in - the outermost one, so a callback inside it is its own - or nothing outside any function. */
const outermostFunction = (node: TsNode): TsNode | undefined => {
  let found: TsNode | undefined;
  for (let at = node.getParent(); at !== undefined && !Node.isSourceFile(at); at = at.getParent()) if (isFunctionNode(at)) found = at;
  return found;
};

/** Whether a declaration is a static field of a class of the repository: a store the class keeps, which any module may name as `Registry.items` (P320). */
const isStaticStore = (declaration: TsNode | undefined): declaration is PropertyDeclaration =>
  declaration !== undefined && Node.isPropertyDeclaration(declaration) && declaration.isStatic() && !inLibrary(declaration) && Node.isClassDeclaration(declaration.getParent());

/**
 * Every place the repository names a store, found by the checker's
 * references so an import under another name is the same store (P314): the
 * functions naming it, each a function that may add to it, and the values
 * added to it outside any function, in any module. A class's static field is
 * followed the same way (`Registry.items.push(...)` in another module, a
 * static block of the class), and an instance's field where the instance is
 * one a `const` holds, named off that `const` (P320) or off anything holding
 * it - a parameter it is handed, a field of another class given it, an
 * import (P326).
 */
const storeReach = (declaration: StoreDeclaration, instance?: Held): StoreReach => {
  const byInstance = REACHES.get(declaration) ?? new Map<TsNode, StoreReach>();
  REACHES.set(declaration, byInstance);
  const known = byInstance.get(instance ?? declaration);
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
  const isStore: StoreTest = (root) => {
    if (!(Node.isIdentifier(root) || Node.isPropertyAccessExpression(root)) || declarationOf(root) !== declaration) return false;
    if (instance === undefined) return true;
    return Node.isPropertyAccessExpression(root) && holds(root.getExpression(), instance);
  };
  const own = Node.isVariableDeclaration(declaration) ? declaration.getVariableStatement() : undefined;
  for (const reference of references) {
    if (reference === name || inLibrary(reference)) continue;
    const fn = outermostFunction(reference);
    if (fn !== undefined) {
      functions.add(fn);
      continue;
    }
    const statement = reference.getFirstAncestor((each) => Node.isSourceFile(each.getParent()));
    if (statement !== undefined && statement !== own) statements.add(statement);
  }
  const reach = { functions: [...functions], added: [...statements].flatMap((statement) => addedAtTop(statement, isStore)), isStore };
  byInstance.set(instance ?? declaration, reach);
  return reach;
};

/** Whether a store is one to look for across the repository: a `Map`, a `Set`, an array or an object made empty or written in place, or a variable given none. */
const isKeptStore = (declaration: StoreDeclaration): boolean => {
  const value = declaration.getInitializer();
  const held = value === undefined ? undefined : bare(value);
  return held === undefined || Node.isNewExpression(held) || Node.isArrayLiteralExpression(held) || Node.isObjectLiteralExpression(held);
};

/** The items written into a store kept under a variable or a static field: its array written in place, and what any module adds to it outside a function (P314, P320). */
const writtenInto = (declaration: TsNode): TsNode[] => {
  if (!Node.isVariableDeclaration(declaration) && !Node.isPropertyDeclaration(declaration)) return [];
  const value = declaration.getInitializer();
  const held = value === undefined ? undefined : bare(value);
  const found: TsNode[] = held !== undefined && Node.isArrayLiteralExpression(held) ? [...held.getElements()] : [];
  return isKeptStore(declaration) ? [...found, ...storeReach(declaration).added] : found;
};

/** The object literal a function written as a member of one is held by, or the class a method is written in (P320). */
const holderOf = (fn: TsNode): Holder | undefined => {
  const parent = fn.getParent();
  if (Node.isMethodDeclaration(fn) && parent !== undefined && Node.isClassDeclaration(parent)) return parent;
  const holder = parent !== undefined && Node.isPropertyAssignment(parent) ? parent.getParent() : parent;
  return holder !== undefined && Node.isObjectLiteralExpression(holder) ? holder : undefined;
};

/** The name a function of the repository is called by: its own, or the `const` or the property holding it. */
const nameOf = (fn: TsNode): string | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getName();
  const parent = fn.getParent();
  return parent !== undefined && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) ? parent.getName() : undefined;
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
 * to objects written over the entry (`store.map((route) => ({ ...route,
 * path: base + route.path }))`, a `flatMap`, `Array.from(store, fn)` or a
 * `reduce` gathering objects, P326), or something else made of them, which is
 * not read.
 */
type StoreView =
  | { readonly kind: 'entries' }
  | { readonly kind: 'mapped'; readonly objects: readonly Written[]; readonly parameter: ParameterDeclaration }
  | { readonly kind: 'unread'; readonly why: string };

/** What a step writes for an item: an object written over it, or the item itself where it is handed on as it is (its parameter, P326). */
type Written = ObjectLiteralExpression | ParameterDeclaration;

const ENTRIES: StoreView = { kind: 'entries' };

/** The methods of a list a view of a store passes through keeping its entries as they are. */
const VIEW_KEEPING: ReadonlySet<string> = new Set(['filter', 'find', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'concat', 'values', 'flat']);

/** Whether a node names a step's parameter: the item handed on as it is. */
const isItem = (node: TsNode, item: ParameterDeclaration): boolean => Node.isIdentifier(node) && (node.getSymbol()?.getDeclarations() ?? []).includes(item as never);

/**
 * What a step hands back for one item (P326): an object written in place, or
 * the item itself; a list of them, either side of a condition (`page.hidden ?
 * [] : [page]`), none for an empty list.
 */
const objectsOf = (node: TsNode, item: ParameterDeclaration, depth = 0): Written[] | undefined => {
  const value = bare(node);
  if (Node.isObjectLiteralExpression(value)) return [value];
  if (isItem(value, item)) return [item];
  if (Node.isConditionalExpression(value) && depth < 4) {
    const sides = [value.getWhenTrue(), value.getWhenFalse()].map((side) => objectsOf(side, item, depth + 1));
    return sides.every((side) => side !== undefined) ? (sides as Written[][]).flat() : undefined;
  }
  if (!Node.isArrayLiteralExpression(value)) return undefined;
  const found: Written[] = [];
  for (const element of value.getElements()) {
    const each = bare(element);
    if (Node.isObjectLiteralExpression(each)) found.push(each);
    else if (isItem(each, item)) found.push(item);
    else return undefined;
  }
  return found;
};

/** The entries a view mapped over one entry is: each object bound over it, or the entry itself (P326). */
const writtenOver = (view: { readonly objects: readonly Written[]; readonly parameter: ParameterDeclaration }, entry: ListEntry): ListEntry[] =>
  view.objects.map((object) => (Node.isParameterDeclaration(object) ? entry : { object, bound: new Map([...(entry.bound ?? []), [view.parameter, entry.object]]) }));

/** The steps a list is turned into objects per item by (P320, P326). */
type Step = 'map' | 'flatMap' | 'reduce';

const STEPS: ReadonlySet<string> = new Set<Step>(['map', 'flatMap', 'reduce']);

const STEP_WORDS: Readonly<Record<Step, { readonly does: string; readonly done: string }>> = {
  map: { does: 'maps each entry', done: 'mapped' },
  flatMap: { does: 'flat-maps each entry', done: 'flat-mapped' },
  reduce: { does: 'reduces the entries', done: 'reduced' },
};

/**
 * The objects a function handed to a list's `map` or `flatMap` writes for
 * each entry, and the entry's name: `(route) => ({ ...route, path })`; for
 * `flatMap` a list of them too, either side of a condition, an empty list
 * leaving the entry out (P326).
 */
const mappedBy = (handed: TsNode | undefined, step: 'map' | 'flatMap' = 'map'): StoreView => {
  const fn = handed === undefined ? undefined : bare(handed);
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return { kind: 'unread', why: `a function of its own ${STEP_WORDS[step].does}` };
  const [parameter] = fn.getParameters();
  const returned = handedBackBy(fn);
  const notRead: StoreView = { kind: 'unread', why: `each entry is ${STEP_WORDS[step].done} to something other than ${step === 'map' ? 'an object' : 'objects'} written over it` };
  if (parameter === undefined || !Node.isIdentifier(parameter.getNameNode()) || returned.length === 0) return notRead;
  if (step === 'map') {
    const object = returned.length === 1 ? bare(returned[0] as TsNode) : undefined;
    return object !== undefined && Node.isObjectLiteralExpression(object) ? { kind: 'mapped', objects: [object], parameter } : notRead;
  }
  const objects: Written[] = [];
  for (const each of returned) {
    const found = objectsOf(each, parameter);
    if (found === undefined) return notRead;
    objects.push(...found);
  }
  return objects.length === 0 ? notRead : { kind: 'mapped', objects, parameter };
};

/**
 * The objects a `reduce` gathers for each entry, starting from an empty list
 * (P326): `(all, route) => [...all, { ...route, path }]`, `all.concat({ ...
 * })`, or `all.push({ ... })` then `return all`, the entry the function's
 * second parameter. Anything else gathered is not read, and why is said.
 */
const reducedBy = (handed: TsNode | undefined, start: TsNode | undefined): StoreView => {
  const fn = handed === undefined ? undefined : bare(handed);
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return { kind: 'unread', why: `a function of its own ${STEP_WORDS.reduce.does}` };
  const initial = start === undefined ? undefined : bare(start);
  if (initial === undefined || !Node.isArrayLiteralExpression(initial) || initial.getElements().length > 0) return { kind: 'unread', why: 'the reduce starts from something other than an empty list' };
  const [gathered, parameter] = fn.getParameters();
  const notRead: StoreView = { kind: 'unread', why: 'each entry is reduced to something other than objects written over it' };
  if (gathered === undefined || parameter === undefined || !Node.isIdentifier(gathered.getNameNode()) || !Node.isIdentifier(parameter.getNameNode())) return notRead;
  const isGathered = (node: TsNode): boolean => Node.isIdentifier(bare(node)) && (bare(node).getSymbol()?.getDeclarations() ?? []).includes(gathered as never);
  const objects: Written[] = [];
  // `all.concat(...)`, `all.push(...)`: each value handed objects written in place, or the entry itself.
  const handedObjects = (call: TsNode): boolean => {
    if (!Node.isCallExpression(call)) return false;
    for (const argument of call.getArguments()) {
      const found = objectsOf(argument, parameter);
      if (found === undefined) return false;
      objects.push(...found);
    }
    return true;
  };
  const gatheredCall = (node: TsNode, name: string): boolean => {
    const callee = Node.isCallExpression(node) ? node.getExpression() : undefined;
    return callee !== undefined && Node.isPropertyAccessExpression(callee) && callee.getName() === name && isGathered(callee.getExpression());
  };
  let read = true;
  const body = fn.getBody();
  if (Node.isBlock(body)) {
    body.forEachDescendant((node, traversal) => {
      if (isFunctionNode(node)) {
        traversal.skip();
        return;
      }
      if (gatheredCall(node, 'push') && !handedObjects(node)) read = false;
    });
  }
  for (const returned of handedBackBy(fn)) {
    const value = bare(returned);
    if (isGathered(value)) continue;
    if (gatheredCall(value, 'concat') && handedObjects(value)) continue;
    if (Node.isArrayLiteralExpression(value)) {
      const added = value.getElements().filter((element) => !(Node.isSpreadElement(element) && isGathered(element.getExpression())));
      const found = added.map((element) => objectsOf(element, parameter));
      if (found.every((each) => each !== undefined && each.length === 1)) {
        objects.push(...(found as Written[][]).flat());
        continue;
      }
    }
    read = false;
  }
  return read && objects.length > 0 ? { kind: 'mapped', objects, parameter } : notRead;
};

/** The view a step of a list makes of its items, as read (P326). */
const stepView = (step: Step, args: readonly TsNode[]): StoreView => (step === 'reduce' ? reducedBy(args[0], args[1]) : mappedBy(args[0], step));

/** Whether a name is the runtime's own `Object` or `Array`, not one the repository declares. */
const isGlobal = (name: TsNode, global: 'Object' | 'Array'): boolean => {
  if (!Node.isIdentifier(name) || name.getText() !== global) return false;
  const declaration = declarationOf(name);
  return declaration === undefined || inLibrary(declaration);
};

/** The view a step makes of a store's view: of its entries as they are, read; of entries mapped already, not. */
const thenStep = (inner: StoreView, step: Step, args: readonly TsNode[]): StoreView => {
  if (inner.kind === 'unread') return inner;
  return inner.kind === 'entries' ? stepView(step, args) : { kind: 'unread', why: 'its entries are mapped twice' };
};

/** The list a call steps over and the view it makes of its items: `list.map(fn)`, `list.flatMap(fn)`, `list.reduce(fn, [])`, `Array.from(list, fn)` (P320, P326). */
const stepOf = (call: CallExpression): { readonly source: TsNode; readonly view: StoreView } | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const args = call.getArguments();
  if (isGlobal(bare(callee.getExpression()), 'Array') && callee.getName() === 'from') {
    const [source] = args;
    return source === undefined ? undefined : { source, view: args.length < 2 ? ENTRIES : mappedBy(args[1]) };
  }
  return STEPS.has(callee.getName()) ? { source: callee.getExpression(), view: stepView(callee.getName() as Step, args) } : undefined;
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
  if (isGlobal(owner, 'Object') || isGlobal(owner, 'Array')) {
    const inner = args[0] === undefined ? undefined : viewIn(args[0], isStore, reader, depth + 1);
    if (inner === undefined) return undefined;
    if (owner.getText() === 'Object' && name === 'values') return inner;
    if (owner.getText() === 'Array' && name === 'from') return args.length < 2 ? inner : thenStep(inner, 'map', args.slice(1));
    return { kind: 'unread', why: `${owner.getText()}.${name}(...) is made of its entries` };
  }
  const inner = viewIn(owner, isStore, reader, depth + 1);
  if (inner === undefined) return undefined;
  if (VIEW_KEEPING.has(name)) return inner;
  // `map`, `flatMap`, `reduce` to objects written over each entry (P326).
  if (STEPS.has(name)) return thenStep(inner, name as Step, args);
  return { kind: 'unread', why: `.${name}(...) is made of its entries` };
};

/** What a registry's reader hands back of its store, over all its `return`s: one view, or none read where they differ. */
const viewOf = (reader: TsNode, isStore: StoreTest): StoreView => {
  const views = handedBackBy(reader).flatMap((returned) => [viewIn(returned, isStore, reader)].filter((each): each is StoreView => each !== undefined));
  const [first] = views;
  if (first === undefined) return ENTRIES;
  const unread = views.find((each) => each.kind === 'unread');
  if (unread !== undefined) return unread;
  if (views.every((each) => each.kind === first.kind && (each.kind !== 'mapped' || (first.kind === 'mapped' && each.objects.length === first.objects.length && each.objects.every((object, at) => object === first.objects[at]))))) return first;
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

/**
 * A registry held by a class of the repository: a method reading a field its
 * other methods add to (P297). A field is followed wherever the repository
 * names it (P320): a static one (`Registry.items.push(...)` in another
 * module, inside a function or outside any), an instance's where the
 * instance is one a `const` holds; each function outside the class naming it
 * is a function that may add to it, called by its name like the class's own.
 * An instance's field is followed off anything holding the instance (P326):
 * a parameter it is handed, a field of another class given it when made, an
 * import; a call adds to it only where what it hands for the store, or the
 * instance of the other class it is made on, holds the instance.
 */
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
  const inside: StoreTest = (root) => Node.isPropertyAccessExpression(root) && fields.has(root.getName()) && isOwner(root.getExpression(), cls);
  // Where each field is named outside the class: a static field anywhere, an instance's off the `const` holding it (P320).
  const reaches = [...fields].flatMap((name) => {
    const declared = instance === undefined ? cls.getStaticProperty(name) : cls.getInstanceProperty(name);
    if (declared === undefined || !Node.isPropertyDeclaration(declared) || !isKeptStore(declared)) return [];
    return [instance === undefined ? storeReach(declared) : storeReach(declared, instance)];
  });
  const isStore: StoreTest = (root) => inside(root) || reaches.some((reach) => reach.isStore(root));
  const within = (node: TsNode): boolean => node.getFirstAncestor((each) => each === cls) !== undefined;
  // `this.register(plugin)`: a method of the class it calls on itself.
  const calls = (node: TsNode, adder: Adder): Adder[] => {
    const target = Node.isCallExpression(node) ? node.getExpression() : undefined;
    if (target === undefined || !Node.isPropertyAccessExpression(target) || !isOwner(target.getExpression(), cls)) return [];
    const called = cls.getMethods().find((each) => each.getName() === target.getName() && each.getBody() !== undefined);
    return called === undefined ? [] : [{ fn: called, isStore: adder.isStore }];
  };
  const adders = new Map<TsNode, Storing & { readonly storeParameter?: number }>();
  for (const method of cls.getMethods()) {
    if (method === reader || method.isStatic() !== (instance === undefined) || method.getBody() === undefined) continue;
    const stores = storing({ fn: method, isStore }, calls);
    if (stores !== undefined) adders.set(method, stores);
  }
  // The functions outside the class naming a field: each one that adds to it is an adding function of the registry's (P320), with
  // the other methods of a class one of them is written in, which may add through it (`this.keep(panel)`, P326).
  const candidates = new Set<TsNode>();
  for (const fn of reaches.flatMap((reach) => reach.functions)) {
    if (within(fn)) continue;
    candidates.add(fn);
    const other = holderOf(fn);
    if (other !== undefined && Node.isClassDeclaration(other)) for (const method of other.getMethods()) if (method.getBody() !== undefined) candidates.add(method);
  }
  // `this.keep(panel)` in a method of another class: that class's own method.
  const otherCalls = (node: TsNode, adder: Adder): Adder[] => {
    const target = Node.isCallExpression(node) ? node.getExpression() : undefined;
    const other = holderOf(adder.fn);
    if (target === undefined || !Node.isPropertyAccessExpression(target) || !Node.isThisExpression(bare(target.getExpression())) || other === undefined || !Node.isClassDeclaration(other)) return [];
    const called = memberFunction(other, target.getName());
    return called === undefined ? [] : [{ fn: called, isStore: adder.isStore }];
  };
  /** The parameter of a function a store is reached off (`registry.items.push(panel)` in `installPanel(registry, panel)`), where it is (P326). */
  const storeParameterOf = (fn: TsNode): number | undefined => {
    let found: number | undefined;
    fn.forEachDescendant((node, traversal) => {
      if (!Node.isPropertyAccessExpression(node) || !isStore(node)) return;
      found = parameterIndex(fn, bare(node.getExpression()));
      if (found !== undefined) traversal.stop();
    });
    return found;
  };
  const outside = new Set<TsNode>();
  for (const fn of candidates) {
    if (adders.has(fn)) continue;
    const storeParameter = instance === undefined ? undefined : storeParameterOf(fn);
    const stores = storing({ fn, isStore, ...(storeParameter === undefined ? {} : { storeParameter }) }, otherCalls);
    if (stores === undefined) continue;
    adders.set(fn, { ...stores, ...(storeParameter === undefined ? {} : { storeParameter }) });
    outside.add(fn);
  }
  /**
   * Whether an instance of another class adds to this registry's instance:
   * a field of it, written with what its own `new` hands, holds the
   * instance (`new PanelBook(panels)`, `this.registry.items`, P326).
   */
  const reachesThrough = (other: ClassDeclaration, self: Held): boolean =>
    instance !== undefined &&
    other.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some((access) => {
      const field = bare(access.getExpression());
      return Node.isPropertyAccessExpression(field) && Node.isThisExpression(bare(field.getExpression())) && fields.has(access.getName()) && isStore(access) && holds(field, instance, self);
    });
  /** The class's own adding method a call names: on itself, on the class, or on anything holding the instance (P320, P326). */
  const ownAdder = (adding: CallExpression): TsNode | undefined => {
    const target = adding.getExpression();
    if (!Node.isPropertyAccessExpression(target)) return undefined;
    const receiver = bare(target.getExpression());
    if (Node.isThisExpression(receiver)) {
      if (!within(adding)) return undefined;
    } else if (!(within(adding) && isOwner(receiver, cls)) && !holds(receiver, instance ?? cls)) return undefined;
    return [...adders.keys()].find((method) => !outside.has(method) && (method as MethodDeclaration).getName() === target.getName());
  };
  return {
    reader,
    isStore,
    adders,
    names: [...adders.keys()].flatMap((fn) => [nameOf(fn)].filter((name): name is string => name !== undefined)),
    adderOf: (adding) => {
      const found = ownAdder(adding);
      if (found !== undefined) return found;
      const fn = ownFunctionOf(adding.getExpression())?.fn;
      return fn !== undefined && outside.has(fn) ? fn : undefined;
    },
    owns: (node) => within(node) || node.getFirstAncestor((each) => outside.has(each)) !== undefined,
    // An instance's registry: a call adding through a parameter adds to it where it is handed the instance; one on an instance of
    // another class, where that instance's field holds it (`installPanel(drafts, ...)`, a book made over another registry, P326).
    sameRegistry: (adding, adder) => {
      if (instance === undefined || !outside.has(adder)) return true;
      const at = adders.get(adder)?.storeParameter;
      if (at !== undefined) {
        const handed = adding.getArguments()[at];
        return handed !== undefined && holds(handed, instance);
      }
      const other = holderOf(adder);
      const target = adding.getExpression();
      if (other === undefined || !Node.isClassDeclaration(other) || !Node.isPropertyAccessExpression(target) || Node.isThisExpression(bare(target.getExpression()))) return true;
      const selves = heldBy(target.getExpression());
      return selves !== undefined && selves.some((self) => reachesThrough(other, self));
    },
    written: [...[...adders.keys()].flatMap((method) => writtenIn(method, isStore)), ...reaches.flatMap((reach) => reach.added)],
  };
};

/**
 * A registry kept by functions (P303): a function of the repository - or a
 * method an object `const` holds - reading a store the functions beside it
 * add to, the store a variable at the top of a module (`const routes = new
 * Map()`, `[]`, `{}`), a field of the object holding them (`this.items`), or
 * one handed in (`routesOf(store, area)` and `addRoute(store, route)`, the
 * same store named at both calls). A class's static field read by name
 * (`Shelf.entries`) is a store as a module's variable is, and the functions
 * reading or adding may be methods of a class, called on the class or on an
 * instance a `const` holds (P320).
 */
const functionRegistry = (call: CallExpression): Registry | undefined => {
  const own = ownFunctionOf(call.getExpression());
  if (own === undefined) return undefined;
  const { fn: reader, holder } = own;
  const modules = new Set<StoreDeclaration>();
  reader.forEachDescendant((node) => {
    if (Node.isPropertyAccessExpression(node)) {
      // `Shelf.entries`: a static field of a class of the repository, as a module's variable is (P320).
      const declaration = declarationOf(node);
      if (isStaticStore(declaration)) modules.add(declaration);
      return;
    }
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
  if (holder !== undefined && Node.isObjectLiteralExpression(holder)) {
    for (const property of holder.getProperties()) if (Node.isPropertyAssignment(property) && memberFunction(holder, property.getName()) === undefined) fields.add(property.getName());
  }
  const fixed: StoreTest = (root) =>
    ((Node.isIdentifier(root) || Node.isPropertyAccessExpression(root)) && modules.has(declarationOf(root) as StoreDeclaration)) ||
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
      // `this.add(route)`: a member of what holds the function the call is written in, the reader's object or class or another's (P320).
      const enclosing = adding.getFirstAncestor((each) => isFunctionNode(each) && holderOf(each) !== undefined);
      const held = enclosing === undefined ? holder : holderOf(enclosing);
      const found =
        held !== undefined && Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression()) ? memberFunction(held, target.getName()) : ownFunctionOf(target)?.fn;
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
 * one back (`useMemo(() => [...])`, a computed value). A list's own `map` to
 * an object written over each item (`listPages().map((page) => ({ ...page,
 * path: `/app${page.path}` }))`) is that object per item, the item bound to
 * the function's parameter, as a registry's reader's view is read (P320); a
 * `flatMap` to objects, `Array.from(list, fn)` and a `reduce` gathering
 * objects into an empty list are read the same way (P326). An item written
 * as anything else is counted as not read, and why is said.
 */
export const listEntries = (expression: TsNode, outerDepth = 0): ListEntries | undefined => {
  const entries: ListEntry[] = [];
  let unread = 0;
  const why = new Set<string>();
  const seen = new Set<TsNode>();
  /** Items not read, and why. */
  const miss = (count: number, because: string | readonly string[]): void => {
    if (count <= 0) return;
    unread += count;
    for (const each of typeof because === 'string' ? [because] : because) why.add(each);
  };

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
        miss(Math.max(1, outer?.unread ?? 0), outer === undefined || outer.why.length === 0 ? `an entry is written over ${over.list.getText().replace(/\s+/g, ' ').slice(0, 60)}, a list not read` : outer.why);
        return;
      }
      miss(outer.unread, outer.why);
      for (const element of outer.entries) push({ object: value, bound: new Map([...(element.bound ?? []), [over.parameter, element.object]]) });
      return;
    }
    if (Node.isSpreadElement(value)) {
      if (!list(value.getExpression(), depth + 1)) miss(1, `${value.getText().replace(/\s+/g, ' ').slice(0, 60)} spreads a list not read`);
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
    miss(1, 'an entry is not written as an object in place');
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
        miss(registered.items.length + registered.unread, `the registry's reader hands back a view of its entries not read: ${view.why}`);
        return true;
      }
      const from = entries.length;
      for (const each of registered.items) item(each, depth + 1);
      // Each entry mapped to an object written over it: that object, the entry bound to the function's parameter (P314).
      if (view.kind === 'mapped') for (const entry of entries.splice(from)) for (const each of writtenOver(view, entry)) push(each);
      miss(registered.unread, 'an entry handed to the registry is not written as an object in place');
      return true;
    }
    // A list's own `map`, `flatMap` or `reduce` to objects written over each item, or `Array.from(list, fn)`: the objects per item
    // read, the item bound to the function's parameter (P320, P326).
    const step = stepOf(value);
    if (step !== undefined) {
      const from = entries.length;
      const before = { unread, why: [...why] };
      if (list(step.source, depth + 1)) {
        const { view } = step;
        const items = entries.splice(from);
        if (view.kind === 'entries') for (const entry of items) push(entry);
        else if (view.kind === 'mapped') for (const entry of items) for (const each of writtenOver(view, entry)) push(each);
        // A `flatMap` handing back a list read otherwise (`[...route.children, route]`): that list per item, as before.
        else if (!(Node.isPropertyAccessExpression(callee) && callee.getName() === 'flatMap' && handedLists(value, depth))) miss(items.length, `the list is mapped in a way not read: ${view.why}`);
        return true;
      }
      // Not a list read: what the inner reading counted is set aside, and the call is read as any other.
      entries.splice(from);
      unread = before.unread;
      why.clear();
      for (const each of before.why) why.add(each);
    }
    if (Node.isPropertyAccessExpression(callee) && SUBSET_METHODS.has(callee.getName())) {
      const read = list(callee.getExpression(), depth + 1);
      if (callee.getName() === 'concat') for (const argument of value.getArguments()) if (!list(argument, depth + 1)) item(argument, depth + 1);
      return read;
    }
    // A function of the repository that hands the list back, then a call handed one that does.
    const fn = calledFunction(callee);
    if (fn !== undefined && returnedBy(fn).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    return handedLists(value, depth);
  };

  /** Whether a function a call is handed hands back a list read: `useMemo(() => [...])`, a computed value. */
  const handedLists = (call: CallExpression, depth: number): boolean => {
    for (const argument of call.getArguments()) {
      const handed = bare(argument);
      if (!Node.isArrowFunction(handed) && !Node.isFunctionExpression(handed)) continue;
      if (returnedBy(handed).map((returned) => list(returned, depth + 1)).some(Boolean)) return true;
    }
    return false;
  };

  return list(expression, 0) ? { entries, unread, why: [...why] } : undefined;
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
