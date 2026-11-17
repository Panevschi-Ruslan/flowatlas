import { argumentAlong, callSitesOf, decoratorModule, handedByEachCall } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, MethodDeclaration, NewExpression, Node as TsNode, ParameterDeclaration, PropertyDeclaration } from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';

/**
 * What a request's receiver may hold, where the compiler does not say (P301).
 *
 * `xhr.open(verb, url)` and `api.get(path)` are known for requests by the
 * type of what they are called on, or by the instance the name leads back to.
 * In a plain script the compiler often knows nothing of either: a parameter
 * has no type, `this.request` is a field the class declares as `null` and
 * fills in later, or is handed in to the constructor. What the receiver holds
 * is then read where it is given its values: a parameter by what each caller
 * hands it, one call out at a time (P312), a constructor's
 * parameter by each `new`, a field of a class or of an object by its
 * initializer and every `this.<field> = ...` its methods write, a variable by
 * its initializer and what is assigned to it. Followed until `isLeaf` says a
 * value is known for what it is, and a few steps at most.
 */

/** How many names a receiver is followed through: each caller one at a time (P312). */
const DEPTH = 6;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current) || Node.isTypeAssertion(current)) {
    current = current.getExpression();
  }
  return current;
};

/** The node `this` is bound to where it is written: a class or an object written in place; nothing in a plain function. */
export const thisOwnerOf = (node: TsNode): TsNode | undefined => {
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    // An arrow function keeps the `this` of where it is written.
    if (Node.isArrowFunction(at)) continue;
    if (Node.isClassDeclaration(at) || Node.isClassExpression(at)) return at;
    const isMember = Node.isMethodDeclaration(at) || Node.isConstructorDeclaration(at) || Node.isGetAccessorDeclaration(at) || Node.isSetAccessorDeclaration(at) || Node.isPropertyDeclaration(at);
    if (isMember || Node.isFunctionExpression(at) || Node.isFunctionDeclaration(at)) {
      const holder = at.getParent();
      if (holder !== undefined && (Node.isClassDeclaration(holder) || Node.isClassExpression(holder))) return holder;
      if (holder !== undefined && Node.isObjectLiteralExpression(holder)) return holder;
      const object = holder !== undefined && Node.isPropertyAssignment(holder) ? holder.getParent() : undefined;
      return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
    }
  }
  return undefined;
};

/** Whether a node is `this.<field>`. */
const isThisField = (node: TsNode): node is TsNode & { getName(): string } =>
  Node.isPropertyAccessExpression(node) && node.getExpression().getKind() === SyntaxKind.ThisKeyword;

/** Every value a field of a class or an object is given: where it is declared, and by each `this.<field> = ...`. */
export const fieldValues = (owner: TsNode, field: string): TsNode[] => {
  const values: TsNode[] = [];
  if (Node.isClassDeclaration(owner) || Node.isClassExpression(owner)) {
    const declared = owner.getProperty(field)?.getInitializer();
    if (declared !== undefined) values.push(declared);
    // A parameter property, `constructor(private request)`, holds what each `new` hands it.
    for (const constructor of owner.getConstructors()) {
      for (const parameter of constructor.getParameters()) if (parameter.isParameterProperty() && parameter.getName() === field) values.push(parameter.getNameNode());
    }
  }
  if (Node.isObjectLiteralExpression(owner)) {
    const property = owner.getProperty(field);
    if (property !== undefined && Node.isPropertyAssignment(property)) {
      const written = property.getInitializer();
      if (written !== undefined) values.push(written);
    } else if (property !== undefined && Node.isShorthandPropertyAssignment(property)) values.push(property.getNameNode());
  }
  for (const binary of owner.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = unwrap(binary.getLeft());
    if (isThisField(left) && left.getName() === field && thisOwnerOf(left) === owner) values.push(binary.getRight());
  }
  return values;
};

/** The calls that make an instance of a class: each `new Class(...)`. */
const constructions = (owner: TsNode): NewExpression[] => {
  if (!Node.isClassDeclaration(owner)) return [];
  const name = owner.getNameNode();
  if (name === undefined) return [];
  return name.findReferencesAsNodes().flatMap((reference) => {
    const made = reference.getParent();
    return made !== undefined && Node.isNewExpression(made) && made.getExpression() === reference ? [made] : [];
  });
};

/** What one call hands a parameter: the call, none for the parameter's own default, and the argument. */
export interface Handed {
  readonly call: CallExpression | NewExpression | undefined;
  readonly argument: TsNode;
}

/**
 * What each caller hands a parameter, one call out: through the function's
 * calls, or each `new` of a constructor's class. A caller that hands on a
 * parameter of its own is one of them (P312) - `mid(r) { start(r); r.send() }`
 * hands `start` its `r`, which is where the request is sent - and the name
 * is followed out from there, to its own callers, one level at a time.
 */
export const handedAt = (parameter: ParameterDeclaration): Handed[] => {
  const owner = parameter.getParent();
  const index = Node.isParametered(owner) ? owner.getParameters().indexOf(parameter) : -1;
  if (index < 0) return [];
  const fallback = parameter.getInitializer();
  if (Node.isConstructorDeclaration(owner)) {
    return constructions(owner.getParent()).flatMap((made) => {
      const argument = made.getArguments()[index];
      return argument === undefined ? (fallback === undefined ? [] : [{ call: made, argument: fallback }]) : [{ call: made, argument }];
    });
  }
  const calls: Handed[] = handedByEachCall(parameter);
  return fallback === undefined || calls.some((each) => each.argument === fallback) ? calls : [...calls, { call: undefined, argument: fallback }];
};

/** What each caller hands a parameter, one call out. */
export const handedTo = (parameter: ParameterDeclaration): TsNode[] => handedAt(parameter).map((each) => each.argument);

/** The parameter a value names, where it is one: what a caller was itself handed. */
export const parameterNamed = (value: TsNode): ParameterDeclaration | undefined => {
  const target = unwrap(value);
  const declaration = Node.isIdentifier(target) ? target.getSymbol()?.getDeclarations()[0] : undefined;
  return declaration !== undefined && Node.isParameterDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode()) ? declaration : undefined;
};

/** Every value assigned to a variable or a parameter after it is declared, in the scope it is declared in. */
const assignedTo = (declaration: TsNode, name: TsNode): TsNode[] => {
  const symbol = name.getSymbol();
  const scope = declaration.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at) || Node.isSourceFile(at)) ?? declaration.getSourceFile();
  if (symbol === undefined) return [];
  return scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((binary) => {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return [];
    const left = unwrap(binary.getLeft());
    return Node.isIdentifier(left) && left.getSymbol() === symbol ? [binary.getRight()] : [];
  });
};

/**
 * The values a receiver may hold, each one `isLeaf` knows for what it is or
 * one nothing here follows further (a call, a literal, a parameter nobody
 * calls the function with). Asked once per receiver's declaration.
 */
export const receiverValues = (isLeaf: (value: TsNode) => boolean) => {
  const byKey = new Map<TsNode | string, TsNode[]>();

  const valuesOf = (node: TsNode, depth: number, seen: Set<TsNode | string>): TsNode[] => {
    const target = unwrap(node);
    if (depth > DEPTH || isLeaf(target)) return [target];
    if (Node.isConditionalExpression(target)) return [...valuesOf(target.getWhenTrue(), depth, seen), ...valuesOf(target.getWhenFalse(), depth, seen)];
    if (Node.isBinaryExpression(target)) {
      const operator = target.getOperatorToken().getKind();
      if (operator === SyntaxKind.BarBarToken || operator === SyntaxKind.QuestionQuestionToken) return [...valuesOf(target.getLeft(), depth, seen), ...valuesOf(target.getRight(), depth, seen)];
      if (operator === SyntaxKind.AmpersandAmpersandToken) return valuesOf(target.getRight(), depth, seen);
      return [target];
    }
    // `options.client`: the member of every object the name may hold - an
    // object written in place, or an instance a `new` makes (P324).
    if (Node.isPropertyAccessExpression(target) && target.getExpression().getKind() !== SyntaxKind.ThisKeyword) {
      const objects = valuesOf(target.getExpression(), depth + 1, seen);
      const members = objects.map((object) => memberWritten(object, target.getName()));
      if (objects.length === 0 || members.some((member) => member === undefined)) return [target];
      return members.flatMap((member) => (member ?? []).flatMap((value) => valuesOf(value, depth + 1, seen)));
    }
    const key = keyOf(target);
    if (key === undefined) return [target];
    if (seen.has(key)) return [];
    if (depth === 0 && byKey.has(key)) return byKey.get(key) ?? [];
    seen.add(key);
    const given = givenTo(target);
    const values = given === undefined ? [target] : given.flatMap((value) => valuesOf(value, depth + 1, seen));
    if (depth === 0) byKey.set(key, values);
    return values;
  };

  return (receiver: TsNode): TsNode[] => valuesOf(receiver, 0, new Set());
};

/**
 * What a member of one object is given where the object says (P324): a
 * property an object written in place holds, a shorthand's name, or each
 * value a class gives the field of an instance a `new` makes. Nothing where
 * the object is no such thing or does not name the member.
 */
const memberWritten = (object: TsNode, member: string): TsNode[] | undefined => {
  if (Node.isObjectLiteralExpression(object)) {
    const property = object.getProperty(member);
    if (property !== undefined && Node.isPropertyAssignment(property)) {
      const written = property.getInitializer();
      return written === undefined ? undefined : [written];
    }
    if (property === undefined || !Node.isShorthandPropertyAssignment(property)) return undefined;
    const declaration = declarationNamed(property.getNameNode());
    return declaration !== undefined && (Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration)) ? [declaration.getNameNode()] : undefined;
  }
  const owner = classMade(object);
  const given = owner === undefined ? [] : fieldValues(owner, member);
  return given.length === 0 ? undefined : given;
};

/** The class of this repository a `new` makes an instance of. */
const classMade = (object: TsNode): ClassDeclaration | undefined => {
  if (!Node.isNewExpression(object)) return undefined;
  const made = unwrap(object.getExpression());
  const symbol = Node.isIdentifier(made) ? made.getSymbol() : undefined;
  const owner = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  return owner !== undefined && Node.isClassDeclaration(owner) ? owner : undefined;
};

/** What a name is told apart by: its declaration, or a class's or an object's field. */
const keyOf = (target: TsNode): TsNode | string | undefined => {
  if (isThisField(target)) {
    const owner = thisOwnerOf(target);
    return owner === undefined ? undefined : `${owner.getSourceFile().getFilePath()}:${owner.getStart()}:${target.getName()}`;
  }
  if (!Node.isIdentifier(target)) return undefined;
  return target.getSymbol()?.getDeclarations()[0];
};

/** The values a name or a field is given, or nothing where it is no name that is followed. */
const givenTo = (target: TsNode): TsNode[] | undefined => {
  if (isThisField(target)) {
    const owner = thisOwnerOf(target);
    return owner === undefined ? undefined : fieldValues(owner, target.getName());
  }
  if (!Node.isIdentifier(target)) return undefined;
  const symbol = target.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
  if (Node.isParameterDeclaration(declaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) return undefined;
    return [...handedTo(declaration), ...assignedTo(declaration, name)];
  }
  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) return undefined;
    const written = declaration.getInitializer();
    const constant = declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const;
    return [...(written === undefined ? [] : [written]), ...(constant ? [] : assignedTo(declaration, name))];
  }
  if (Node.isPropertyAssignment(declaration) || Node.isPropertyDeclaration(declaration)) {
    const written = declaration.getInitializer();
    return written === undefined ? [] : [written];
  }
  return undefined;
};

/** A value read along calls, with the calls still further out than where it is written. */
interface Along {
  readonly value: TsNode;
  readonly hops: readonly CallExpression[];
}

/** The calls further out than the one an argument is written in. */
const hopsAfter = (argument: TsNode, hops: readonly CallExpression[]): readonly CallExpression[] => {
  const at = hops.findIndex((hop) => hop.getArguments().some((each) => each === argument || (each.getPos() <= argument.getPos() && argument.getEnd() <= each.getEnd())));
  return at < 0 ? hops : hops.slice(at + 1);
};

/** What a parameter is handed along the calls, and the calls further out than it. */
const handedAlongHops = (parameter: ParameterDeclaration, hops: readonly CallExpression[]): Along | undefined => {
  // A constructor's parameter is handed by each `new`, which no call says.
  if (Node.isConstructorDeclaration(parameter.getParent())) return undefined;
  const handed = argumentAlong(parameter, hops);
  return handed === undefined || handed === null ? undefined : { value: handed, hops: hopsAfter(handed, hops) };
};

/**
 * The declaration a name stands for: a shorthand member, `{ client }`, is
 * the name it takes its value from.
 */
const declarationNamed = (name: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const parent = name.getParent();
  const symbol = parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === name ? parent.getValueSymbol() : name.getSymbol();
  return symbol?.getDeclarations()[0];
};

/**
 * The objects an expression holds along the calls a request's address came
 * out through (P324): an object written in place, an instance a `new` makes,
 * followed through what each call hands a parameter and through a name's
 * value. Nothing where neither says.
 */
const objectsAlong = (value: TsNode, hops: readonly CallExpression[], depth: number): Along[] | undefined => {
  if (depth > DEPTH) return undefined;
  const target = unwrap(value);
  if (Node.isObjectLiteralExpression(target) || Node.isNewExpression(target)) return [{ value: target, hops }];
  const declaration = declarationNamed(target);
  if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
    const handed = handedAlongHops(declaration, hops);
    return handed === undefined ? undefined : objectsAlong(handed.value, handed.hops, depth + 1);
  }
  if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const written = declaration.getInitializer();
    // A name given another value later holds one this does not tell.
    if (written === undefined || !Node.isIdentifier(name) || assignedTo(declaration, name).length > 0) return undefined;
    return objectsAlong(written, hops, depth + 1);
  }
  return undefined;
};

/** The parameter of a class's constructor a field's value names, and where it stands. */
const constructorParameterOf = (value: TsNode, owner: TsNode): { index: number; parameter: ParameterDeclaration } | undefined => {
  const parent = value.getParent();
  const parameter = parent !== undefined && Node.isParameterDeclaration(parent) && parent.getNameNode() === value ? parent : parameterNamed(value);
  const constructor = parameter?.getParent();
  if (parameter === undefined || constructor === undefined || !Node.isConstructorDeclaration(constructor) || constructor.getParent() !== owner) return undefined;
  return { index: constructor.getParameters().indexOf(parameter), parameter };
};

/**
 * What a member of each object holds: a property written in the object, or
 * a field of the instance a `new` makes - what that `new` hands the
 * constructor's parameter the field is filled from, or what the class
 * writes into it itself. Nothing where an object does not say.
 */
const membersOf = (objects: readonly Along[], member: string, depth: number): TsNode[] | undefined => {
  const values: TsNode[] = [];
  for (const { value: object, hops } of objects) {
    if (Node.isObjectLiteralExpression(object)) {
      const [written] = memberWritten(object, member) ?? [];
      if (written === undefined) return undefined;
      values.push(...(valuesAlong(written, hops, depth + 1) ?? [written]));
      continue;
    }
    const owner = classMade(object);
    if (owner === undefined || !Node.isNewExpression(object)) return undefined;
    const given = fieldValues(owner, member);
    if (given.length === 0) return undefined;
    for (const value of given) {
      const handed = constructorParameterOf(value, owner);
      if (handed === undefined) {
        values.push(value);
        continue;
      }
      const argument = object.getArguments()[handed.index] ?? handed.parameter.getInitializer();
      if (argument !== undefined) values.push(...(valuesAlong(argument, hops, depth + 1) ?? [argument]));
    }
  }
  return values;
};

/**
 * What a member of the instance one call is made on holds (P324): `reader`
 * in `reader.health()`, `new Reader(stockApi)` in `new Reader(stockApi).health()`,
 * read as a field of `this` in `health` is read along calls. Nothing where
 * the instance is not followed - `this`, a parameter no call along says.
 */
export const memberOfInstance = (instance: TsNode, member: string): TsNode[] | undefined => {
  const objects = objectsAlong(instance, [], 0);
  return objects === undefined ? undefined : membersOf(objects, member, 0);
};

/**
 * What a request's receiver is handed along the calls its address came out
 * through (P318, P324): a parameter, by what the caller along those calls
 * hands it; a field of `this`, by what the instance the call is made on was
 * given - `new Reader(catalogApi).read('/latest')` hands `catalogApi` to the
 * constructor that fills `this.api`; a member of an object, by that object's
 * member as it is handed along - `readOn({ client: stockApi }, '/levels')`
 * for `options.client`. The values are what is handed, to be followed for
 * what each is; nothing where the calls do not say.
 */
export const valuesAlong = (value: TsNode, hops: readonly CallExpression[], depth = 0): TsNode[] | undefined => {
  if (depth > DEPTH) return undefined;
  const target = unwrap(value);
  const declaration = declarationNamed(target);
  if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
    const handed = handedAlongHops(declaration, hops);
    return handed === undefined ? undefined : (valuesAlong(handed.value, handed.hops, depth + 1) ?? [handed.value]);
  }
  if (!Node.isPropertyAccessExpression(target)) return undefined;
  const member = target.getName();
  if (target.getExpression().getKind() !== SyntaxKind.ThisKeyword) {
    const objects = objectsAlong(target.getExpression(), hops, depth + 1);
    return objects === undefined ? undefined : membersOf(objects, member, depth);
  }
  // `this.api`: the instance the innermost call is made on. A method of the
  // same instance calling this one leaves the field the same, one call out.
  const [hop, ...further] = hops;
  const callee = hop?.getExpression();
  if (callee === undefined || !Node.isPropertyAccessExpression(callee)) return undefined;
  const instance = unwrap(callee.getExpression());
  if (instance.getKind() === SyntaxKind.ThisKeyword) return valuesAlong(target, further, depth + 1);
  const objects = objectsAlong(instance, further, depth + 1);
  return objects === undefined ? undefined : membersOf(objects, member, depth);
};

/** A value followed out to where it is handed, and the node it is handed at there (P330). */
export interface Placed {
  readonly value: TsNode;
  /** Where the value is handed: the outermost argument or instance it was followed out through. */
  readonly at: TsNode;
}

/** How many steps out a receiver is followed past the calls its address came out through (P330). */
const OUT = 8;

/** How many steps one receiver is read through in all, however many callers each reaches (P330). */
const STEPS = 256;

/** The method of a class `this` is bound to where it is written: a method, or a field holding an arrow function. */
const methodOfThis = (node: TsNode): TsNode | undefined => {
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isArrowFunction(at)) {
      const holder = at.getParent();
      if (holder !== undefined && Node.isPropertyDeclaration(holder) && holder.getInitializer() === at) return holder;
      continue;
    }
    if (Node.isMethodDeclaration(at)) {
      const owner = at.getParent();
      return owner !== undefined && (Node.isClassDeclaration(owner) || Node.isClassExpression(owner)) ? at : undefined;
    }
    if (Node.isFunctionLikeDeclaration(at) || Node.isClassDeclaration(at) || Node.isClassExpression(at)) return undefined;
  }
  return undefined;
};

/**
 * The methods a framework calls on an instance it holds, by the module the
 * class's base or a decorator of the class is taken from (P336): React's and
 * Preact's class components, Lit's elements, Angular's and NestJS's
 * lifecycle hooks.
 */
const LIFECYCLES: readonly { readonly module: RegExp; readonly methods: ReadonlySet<string> }[] = [
  {
    module: /^(react|preact|preact\/compat)$/,
    methods: new Set(['componentDidMount', 'componentDidUpdate', 'componentWillUnmount', 'shouldComponentUpdate', 'getSnapshotBeforeUpdate', 'componentDidCatch', 'render', 'UNSAFE_componentWillMount', 'UNSAFE_componentWillReceiveProps', 'UNSAFE_componentWillUpdate', 'componentWillMount', 'componentWillReceiveProps', 'componentWillUpdate']),
  },
  { module: /^(lit|lit-element)(\/|$)/, methods: new Set(['connectedCallback', 'disconnectedCallback', 'attributeChangedCallback', 'adoptedCallback', 'firstUpdated', 'updated', 'willUpdate', 'render']) },
  { module: /^@angular\/core$/, methods: new Set(['ngOnInit', 'ngOnChanges', 'ngDoCheck', 'ngAfterContentInit', 'ngAfterContentChecked', 'ngAfterViewInit', 'ngAfterViewChecked', 'ngOnDestroy']) },
  { module: /^@nestjs\/common$/, methods: new Set(['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']) },
];

/** What the browser calls on a custom element it holds, a class extending `HTMLElement` (P336). */
const ELEMENT_CALLBACKS: ReadonlySet<string> = new Set(['connectedCallback', 'disconnectedCallback', 'attributeChangedCallback', 'adoptedCallback']);

/** Whether a module is a package's rather than a file of this repository's. */
const isPackage = (module: string | undefined): module is string => module !== undefined && !module.startsWith('.') && !module.startsWith('/');

/** The module a name is imported from, by `import` or by `require` (P336). */
const importedFrom = (name: TsNode): string | undefined => {
  const root = Node.isPropertyAccessExpression(name) ? unwrap(name.getExpression()) : name;
  const declaration = Node.isIdentifier(root) ? root.getSymbol()?.getDeclarations()[0] : undefined;
  if (declaration === undefined) return undefined;
  if (Node.isImportSpecifier(declaration)) return declaration.getImportDeclaration().getModuleSpecifierValue();
  if (Node.isImportClause(declaration) || Node.isNamespaceImport(declaration)) return declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
  const variable = Node.isBindingElement(declaration) ? declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) : declaration;
  const written = variable !== undefined && Node.isVariableDeclaration(variable) ? variable.getInitializer() : undefined;
  if (written === undefined || !Node.isCallExpression(written) || written.getExpression().getText() !== 'require') return undefined;
  const [module] = written.getArguments();
  return module !== undefined && Node.isStringLiteral(module) ? module.getLiteralText() : undefined;
};

/** The class a method is a member of, and each class it extends, as far as this program declares them. */
const lineageOf = (method: MethodDeclaration | PropertyDeclaration): (ClassDeclaration | TsNode)[] => {
  const out: TsNode[] = [];
  let current: TsNode | undefined = method.getParent();
  for (let depth = 0; depth < DEPTH && current !== undefined && (Node.isClassDeclaration(current) || Node.isClassExpression(current)); depth += 1) {
    out.push(current);
    current = current.getBaseClass();
  }
  return out;
};

/**
 * Whether a framework calls a method no code read calls (P336), and which:
 * a method a decorator of a package marks (a handler the framework registers
 * by it), a lifecycle method of a class whose base or class decorator is
 * taken from a framework that calls it (see {@link LIFECYCLES}), or a custom
 * element's callback on a class extending `HTMLElement`. What is said of it,
 * for a person; `undefined` where none of these is.
 */
export const frameworkCaller = (method: MethodDeclaration | PropertyDeclaration): string | undefined => {
  const name = method.getName();
  for (const decorator of method.getDecorators()) {
    const module = decoratorModule(decorator);
    if (isPackage(module)) return `${module}, by its @${decorator.getName()}`;
  }
  for (const cls of lineageOf(method)) {
    if (!Node.isClassDeclaration(cls) && !Node.isClassExpression(cls)) continue;
    const base = cls.getExtends()?.getExpression();
    const modules = [...(base === undefined ? [] : [importedFrom(base)]), ...cls.getDecorators().map((each) => decoratorModule(each))];
    for (const module of modules) {
      if (!isPackage(module)) continue;
      if (LIFECYCLES.some((each) => each.module.test(module) && each.methods.has(name))) return `${module}, as ${name}`;
    }
    if (base !== undefined && base.getText() === 'HTMLElement' && ELEMENT_CALLBACKS.has(name)) return `the browser, as ${name} of a custom element`;
  }
  return undefined;
};

/** How many names a `new` is followed through to where it is handed on (P336). */
const MOST_HANDED_STEPS = 6;

/**
 * Whether an instance is handed to what holds it for the framework (P336):
 * written - in a list, a record, a function answering it, a `const` - into
 * an argument of a call to what this program does not declare (a module's
 * `register(new Poller(api))`, a provider's `useValue`, `useFactory`) or of
 * a decorator.
 */
const handedToFramework = (made: TsNode): boolean => {
  const queue: TsNode[] = [made];
  for (let steps = 0; queue.length > 0 && steps < MOST_HANDED_STEPS; steps += 1) {
    let node = queue.shift() as TsNode;
    for (let up = 0; up < MOST_HANDED_STEPS; up += 1) {
      const parent = node.getParent();
      if (parent === undefined) break;
      if (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isArrayLiteralExpression(parent) || Node.isSatisfiesExpression(parent)) {
        node = parent;
        continue;
      }
      if (Node.isPropertyAssignment(parent) && parent.getInitializer() === node) {
        node = parent.getParentOrThrow();
        continue;
      }
      if (Node.isArrowFunction(parent) && parent.getBody() === node) {
        node = parent;
        continue;
      }
      if (Node.isReturnStatement(parent)) {
        const fn = parent.getFirstAncestor((each) => Node.isArrowFunction(each) || Node.isFunctionExpression(each));
        if (fn === undefined) break;
        node = fn;
        continue;
      }
      if (Node.isDecorator(parent)) return true;
      if (Node.isCallExpression(parent) && parent.getArguments().includes(node)) {
        if (Node.isDecorator(parent.getParent())) return true;
        const callee = unwrap(parent.getExpression());
        const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
        const declarations = named.getSymbol()?.getDeclarations() ?? [];
        return declarations.every((each) => each.getSourceFile().isInNodeModules() || each.getSourceFile().isDeclarationFile());
      }
      if (Node.isVariableDeclaration(parent) && parent.getInitializer() === node) {
        const variable = parent.getNameNode();
        if (Node.isIdentifier(variable)) for (const reference of variable.findReferencesAsNodes()) if (reference !== variable) queue.push(reference);
      }
      break;
    }
  }
  return false;
};

/**
 * The instances of a method's class a framework holds (P336): each `new` of
 * the class, or of one extending it, that is handed to what registers it
 * for the framework (see {@link handedToFramework}).
 */
export const frameworkInstances = (method: MethodDeclaration | PropertyDeclaration): NewExpression[] => {
  const owner = method.getParent();
  if (owner === undefined || !Node.isClassDeclaration(owner)) return [];
  return [owner, ...owner.getDerivedClasses()].flatMap((cls) => constructions(cls)).filter(handedToFramework);
};

/** Each placed value of each of several, or nothing where any one is not followed. */
const everyPlaced = <T>(items: readonly T[], each: (item: T) => Placed[] | undefined): Placed[] | undefined => {
  const placed: Placed[] = [];
  for (const item of items) {
    const found = each(item);
    if (found === undefined) return undefined;
    placed.push(...found);
  }
  return placed;
};

/**
 * What a request's receiver holds, followed out past the calls its address
 * came out through to the outermost place each value is given (P330): a
 * parameter by what the call along says, or else by what each caller hands
 * it; `this` by the instance the call along, or each caller of the method,
 * calls it on; a member of an object or of an instance - `this.api`,
 * `options.client` - by what the object it is read on was given, that object
 * followed out the same way. Each value is said at the argument or the
 * instance the last caller followed hands it as, so the request is that
 * caller's: `check(reader) { return reader.health(); }` called as
 * `check(new Reader(stockApi))` places `stockApi` at that call. Nothing where
 * a step finds no caller or a value it cannot follow.
 */
export const placedOut = (receiver: TsNode, calls: readonly CallExpression[] = [], stopped?: { framework?: string }): Placed[] | undefined => {
  // Every step taken, bounded, so a method many callers reach is not read out of hand.
  let steps = 0;
  const out = (value: TsNode, hops: readonly CallExpression[], at: TsNode, depth: number): Placed[] | undefined => {
    steps += 1;
    if (depth > OUT || steps > STEPS) return undefined;
    const target = unwrap(value);
    if (target.getKind() === SyntaxKind.ThisKeyword) {
      const [hop, ...further] = hops;
      const callee = hop?.getExpression();
      if (callee !== undefined && Node.isPropertyAccessExpression(callee)) return out(callee.getExpression(), further, callee.getExpression(), depth + 1);
      const method = methodOfThis(target);
      if (method === undefined || !(Node.isMethodDeclaration(method) || Node.isPropertyDeclaration(method))) return undefined;
      const sites = callSitesOf(method);
      if (sites.length === 0) {
        // No code read calls it: the framework that does, on the instance it holds (P336).
        const framework = frameworkCaller(method);
        if (framework === undefined) return undefined;
        const held = frameworkInstances(method);
        if (held.length === 0) {
          if (stopped !== undefined) stopped.framework = framework;
          return undefined;
        }
        return everyPlaced(held, (made) => out(made, [], made, depth + 1));
      }
      return everyPlaced(sites, (site) => {
        const called = site.getExpression();
        return Node.isPropertyAccessExpression(called) ? out(called.getExpression(), [], called.getExpression(), depth + 1) : undefined;
      });
    }
    const declaration = declarationNamed(target);
    if (declaration !== undefined && Node.isParameterDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
      // A constructor's parameter is what each `new` hands it, read where its field is.
      if (Node.isConstructorDeclaration(declaration.getParent())) return [{ value: target, at }];
      const along = argumentAlong(declaration, hops);
      if (along === null) return undefined;
      if (along !== undefined) return out(along, hopsAfter(along, hops), along, depth + 1);
      const handed = handedAt(declaration);
      if (handed.length === 0) return undefined;
      return everyPlaced(handed, ({ argument }) => out(argument, [], argument, depth + 1));
    }
    if (Node.isPropertyAccessExpression(target)) {
      const objects = out(target.getExpression(), hops, at, depth + 1);
      if (objects === undefined) return undefined;
      return everyPlaced(objects, (object) => {
        const members = memberOfInstance(object.value, target.getName());
        return members === undefined ? undefined : everyPlaced(members, (member) => out(member, [], object.at, depth + 1));
      });
    }
    return [{ value: target, at }];
  };
  return out(receiver, calls, receiver, 0);
};
