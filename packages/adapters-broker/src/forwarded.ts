import {
  callSitesOf,
  dispatchOf,
  evaluateExpression,
  importOf,
  parameterBehind,
  walkPath,
  type DiMap,
  type Forwarder,
} from '@flowatlas/core';
import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type ClassDeclaration,
  type MethodDeclaration,
  type Node as TsNode,
  type ParameterDeclaration,
} from 'ts-morph';

/**
 * A publish whose queue the code that calls it decides (P267).
 *
 * A service that runs its queues through a layer of its own writes the
 * broker's call once, deep inside that layer, and every enqueue of the
 * service is a call of the layer: `this.mailQueue.add(SendMailJob.name,
 * data)` into `this.driver.add(this.queueName, jobName, data)` into
 * `this.queues[queueName].add(jobName, data)`. Read where the broker's call
 * is written, the queue is a parameter and the job a parameter, and every
 * channel of the service had consumers and not one producer.
 *
 * So the values the broker's call is handed are followed out through the
 * calls that hand them in, the way a request made inside a shared client is
 * read at each of its callers, until each is written somewhere: a parameter
 * becomes what its caller passes; a field the instance was built with becomes
 * what the instance was built with, read where the caller was handed the
 * instance - the decorator that asked the container for it, followed to the
 * provider that built it, or the `new` that made it. The publish is then drawn
 * at the call that decided it, once per such call.
 */

/** What one value of a publish is, where the walk has got to. */
export type Held =
  /**
   * Written here: read as a name, a job or a message. `choices` where it is
   * one of several values written out - each branch of a condition, each
   * record a function may answer (P286).
   */
  | { readonly kind: 'written'; readonly expression: TsNode; readonly choices?: readonly TsNode[] }
  /** A parameter, or a property of one: decided by whoever calls its function. */
  | { readonly kind: 'parameter'; readonly parameter: ParameterDeclaration; readonly path: readonly string[]; readonly expression: TsNode }
  /** A field the instance was constructed with: decided by whoever built the instance. */
  | { readonly kind: 'field'; readonly owner: ClassDeclaration; readonly index: number; readonly expression: TsNode }
  /**
   * What the instance was set up with by a call of another of its methods:
   * `this.queue = new Queue(name)` in `open(name)`, read in `add` (P286).
   * Decided by whatever calls `method` on the same instance as the caller
   * holds.
   */
  | {
      readonly kind: 'set';
      readonly owner: ClassDeclaration;
      readonly method: MethodDeclaration;
      readonly index: number;
      readonly path: readonly string[];
      readonly expression: TsNode;
    }
  /** Followed as far as it goes, and no further: `why` says where it stopped. */
  | { readonly kind: 'unread'; readonly expression: TsNode; readonly why: string };

/** How many calls out a value is followed. */
const MOST_HOPS = 5;
/** How many places one publish is drawn at, at most. */
const MOST_SITES = 2000;
/** How many decorators and functions a token is followed through. */
const MOST_LINKS = 4;

const unwrapped = (node: TsNode): TsNode => {
  let current = node;
  for (let step = 0; step < 8; step += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

const declarationOf = (node: TsNode): TsNode | undefined => {
  const parent = node.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
      ? parent.getValueSymbol()
      : node.getSymbol();
  return symbol?.getDeclarations()[0];
};

/** The parameter a name taken out of a destructured parameter belongs to, and the keys it is under. */
const bindingPath = (element: TsNode): { parameter: ParameterDeclaration; path: string[] } | undefined => {
  if (!Node.isBindingElement(element)) return undefined;
  const pattern = element.getParent();
  if (!Node.isObjectBindingPattern(pattern)) return undefined;
  const key = element.getPropertyNameNode()?.getText() ?? element.getName();
  const holder = pattern.getParent();
  if (Node.isParameterDeclaration(holder)) return { parameter: holder, path: [key] };
  const outer = bindingPath(holder);
  return outer === undefined ? undefined : { parameter: outer.parameter, path: [...outer.path, key] };
};

/** Where a class's constructor takes the value a field holds, when that is all the field ever holds. */
export const fieldIndex = (owner: ClassDeclaration, name: string): number | undefined => {
  const [constructor] = owner.getConstructors();
  if (constructor === undefined) return undefined;
  const parameters = constructor.getParameters();
  const own = parameters.findIndex((parameter) => parameter.isParameterProperty() && parameter.getName() === name);
  if (own >= 0) return own;
  const declared = owner.getProperty(name);
  if (declared === undefined || declared.getInitializer() !== undefined || declared.isStatic()) return undefined;
  // `this.queue = queue` in the constructor, and nowhere else in the class.
  let index: number | undefined;
  let elsewhere = false;
  owner.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node) || node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return;
    const left = node.getLeft();
    if (!Node.isPropertyAccessExpression(left) || !Node.isThisExpression(left.getExpression()) || left.getName() !== name) return;
    const inConstructor = node.getFirstAncestorByKind(SyntaxKind.Constructor) === constructor;
    const right = unwrapped(node.getRight());
    const assigned = Node.isIdentifier(right) ? right.getSymbol()?.getDeclarations()[0] : undefined;
    const at = assigned === undefined ? -1 : parameters.findIndex((parameter) => parameter === assigned);
    if (!inConstructor || at < 0 || index !== undefined) elsewhere = true;
    else index = at;
  });
  return elsewhere ? undefined : index;
};

/** What a value written at an expression is, for the walk. */
export const heldAt = (expression: TsNode): Held => {
  const node = unwrapped(expression);
  const declaration = Node.isIdentifier(node) ? declarationOf(node) : undefined;
  if (declaration !== undefined && Node.isBindingElement(declaration)) {
    const bound = bindingPath(declaration);
    if (bound !== undefined) return { kind: 'parameter', ...bound, expression };
  }
  if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
    return { kind: 'parameter', parameter: declaration, path: [], expression };
  }
  if (Node.isPropertyAccessExpression(node)) {
    const target = unwrapped(node.getExpression());
    if (Node.isThisExpression(target)) {
      const owner = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const index = owner === undefined ? undefined : fieldIndex(owner, node.getName());
      if (owner !== undefined && index !== undefined) return { kind: 'field', owner, index, expression };
      return { kind: 'written', expression };
    }
    const inner = heldAt(target);
    if (inner.kind === 'parameter') return { ...inner, path: [...inner.path, node.getName()], expression };
    return { kind: 'written', expression };
  }
  const parameter = parameterBehind(node);
  if (parameter !== undefined) return { kind: 'parameter', parameter, path: [], expression };
  return { kind: 'written', expression };
};

/** Whether a value still waits on somebody further out. */
export const waits = (held: Held): boolean => held.kind === 'parameter' || held.kind === 'field' || held.kind === 'set';

/** Whether a class is the other or extends it, however far up. */
const derivesFrom = (cls: ClassDeclaration, owner: ClassDeclaration): boolean => {
  let current: ClassDeclaration | undefined = cls;
  for (let step = 0; step < 8 && current !== undefined; step += 1) {
    if (current === owner) return true;
    current = current.getBaseClass();
  }
  return false;
};

const isSelf = (receiver: TsNode | undefined): boolean =>
  receiver === undefined || Node.isThisExpression(receiver) || receiver.getKind() === SyntaxKind.SuperKeyword;

/**
 * What a value read at a site is, for the walk: as `heldAt` says, and a
 * parameter of another method of the instance - reached through a field that
 * method sets - as what the instance was set up with (P286).
 */
export const heldAtSite = (expression: TsNode, site: TsNode): Held => {
  const held = heldAt(expression);
  if (held.kind !== 'parameter') return held;
  const fn = held.parameter.getParent();
  if (!Node.isMethodDeclaration(fn) || site.getFirstAncestor((node) => node === fn) !== undefined) return held;
  const owner = fn.getParent();
  const around = methodAround(site)?.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  if (!Node.isClassDeclaration(owner) || around === undefined || !derivesFrom(around, owner)) return held;
  return { kind: 'set', owner, method: fn, index: positionOf(held.parameter), path: held.path, expression: site };
};

/** How deep one value is followed into the values it is made of. */
const MOST_FOLLOWED = 8;

/** Each branch of a condition, as a value of its own (P286). */
const branchesOf = (expression: TsNode, depth = 0): TsNode[] => {
  const node = unwrapped(expression);
  if (!Node.isConditionalExpression(node) || depth > 4) return [expression];
  return [...branchesOf(node.getWhenTrue(), depth + 1), ...branchesOf(node.getWhenFalse(), depth + 1)];
};

/**
 * The values at a path of what an expression holds, for the walk (P286): a
 * record written out, a `const` it was bound to, a record spread into it,
 * each record a function it calls answers - an `async` one awaited as
 * readily - with that function's parameters bound to what the call hands
 * them, and each branch of a condition. Where the path stops at a parameter
 * of the function the walk stands in, the rest of the path is read at its
 * callers.
 */
export const heldValues = (start: TsNode, path: readonly string[], site: TsNode, bound: Bindings = new Map(), depth = 0): Held => {
  if (depth > MOST_FOLLOWED) return { kind: 'unread', expression: start, why: `${start.getText().slice(0, 60)} is made of more values than are followed.` };
  const found: Held[] = [];
  const reached: TsNode[] = [];
  for (const slot of walkPath(start, path, bound)) {
    if (slot === undefined) {
      return { kind: 'unread', expression: start, why: `${start.getText().slice(0, 60)} writes no ${path.join('.')}.` };
    }
    if (slot.reached) {
      reached.push(slot.expression);
      for (const branch of branchesOf(slot.expression)) found.push(heldIn(branch, slot.bound ?? bound, site, depth, []));
    } else {
      found.push(heldIn(slot.expression, slot.bound ?? bound, site, depth, slot.rest ?? []));
    }
  }
  const [first, ...more] = found;
  if (first === undefined) return { kind: 'unread', expression: start, why: `${start.getText().slice(0, 60)} holds nothing written out.` };
  if (more.length === 0) return first;
  if (found.every((each) => each.kind === 'written')) {
    const [one] = reached;
    return {
      kind: 'written',
      expression: reached.length === 1 && one !== undefined ? one : first.expression,
      choices: found.flatMap((each) => (each.kind === 'written' ? (each.choices ?? [each.expression]) : [])),
    };
  }
  return (
    found.find((each) => each.kind === 'unread') ?? {
      kind: 'unread',
      expression: start,
      why: `${start.getText().slice(0, 60)} is one of several values, some decided further out than others.`,
    }
  );
};

/** One value the walk reached, read past the bindings and destructurings it names (P286). */
const heldIn = (expression: TsNode, bound: Bindings, site: TsNode, depth: number, rest: readonly string[]): Held => {
  let node = unwrapped(expression);
  if (Node.isAwaitExpression(node)) node = unwrapped(node.getExpression());
  if (Node.isIdentifier(node)) {
    const declaration = declarationOf(node);
    const handed = declaration === undefined ? undefined : bound.get(declaration);
    if (handed !== undefined) return heldValues(handed, rest, site, bound, depth + 1);
    // `const { type } = options`: the key of what it was taken out of.
    if (declaration !== undefined && Node.isBindingElement(declaration) && declaration.getDotDotDotToken() === undefined) {
      const pattern = declaration.getParent();
      const variable = pattern?.getParent();
      const source = variable !== undefined && Node.isVariableDeclaration(variable) && Node.isObjectBindingPattern(pattern) ? variable.getInitializer() : undefined;
      if (source !== undefined) {
        const key = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
        return heldValues(source, [key, ...rest], site, bound, depth + 1);
      }
    }
  } else if (Node.isPropertyAccessExpression(node) && !Node.isThisExpression(unwrapped(node.getExpression()))) {
    const inner = unwrapped(node.getExpression());
    const root = Node.isIdentifier(inner) ? declarationOf(inner) : undefined;
    // `job.type` where `job` is a parameter the walk bound, or a name taken out of one.
    if (root !== undefined && (bound.has(root) || Node.isBindingElement(root) || Node.isVariableDeclaration(root))) {
      return heldValues(inner, [node.getName(), ...rest], site, bound, depth + 1);
    }
  }
  const held = heldAtSite(node, site);
  if (rest.length === 0) return held;
  if (held.kind === 'parameter' || held.kind === 'set') return { ...held, path: [...held.path, ...rest] };
  return { kind: 'unread', expression: node, why: `${node.getText().slice(0, 60)} is not written out where ${rest[0]} would be read.` };
};

/** The function callers call, for a parameter: the method, the function, or what holds the arrow. */
const holderOfParameter = (parameter: ParameterDeclaration): Forwarder | undefined => {
  const owner = parameter.getParent();
  if (Node.isMethodDeclaration(owner)) return owner;
  if (Node.isFunctionDeclaration(owner)) return owner.getName() === undefined ? undefined : owner;
  if (!Node.isArrowFunction(owner) && !Node.isFunctionExpression(owner)) return undefined;
  const holder = owner.getParent();
  if (Node.isPropertyDeclaration(holder)) return holder;
  return Node.isVariableDeclaration(holder) && holder.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
    ? holder
    : undefined;
};

/** The method a call is written in, past any arrow inside it: what `this` is an instance for. */
const methodAround = (node: TsNode): Forwarder | undefined => {
  const method = node.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  return method;
};

/**
 * The function a value waits on the callers of, at a site: a parameter its
 * own function's, a field whoever calls the method of its class the site is
 * written in.
 */
const holderAt = (value: Held, site: TsNode): Forwarder | undefined => {
  if (value.kind === 'parameter') return holderOfParameter(value.parameter);
  if (value.kind !== 'field' && value.kind !== 'set') return undefined;
  const method = methodAround(site);
  const cls = method?.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  // A method of a class extending the owner holds the same instance (P286).
  return method !== undefined && cls !== undefined && derivesFrom(cls, value.owner) ? method : undefined;
};

/** The `super(...)` call a constructor makes. */
const superCallOf = (cls: ClassDeclaration): CallExpression | undefined =>
  cls
    .getConstructors()[0]
    ?.getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getKind() === SyntaxKind.SuperKeyword);

/**
 * What an instance of `cls` holds in a field its base class `owner` keeps
 * from its constructor's argument `index`, as `cls` and each class between
 * hand it to `super(...)` (P286): `super(QueueName.mail, …)` in a subclass
 * makes every instance of it hold `QueueName.mail`. A value one of them
 * takes as its own constructor's argument is what its instance was built
 * with; undefined where `cls` does not extend `owner`.
 */
const heldThroughSuper = (cls: ClassDeclaration, owner: ClassDeclaration, index: number, expression: TsNode): Held | undefined => {
  const lineage: ClassDeclaration[] = [];
  let current: ClassDeclaration | undefined = cls;
  while (current !== undefined && current !== owner && lineage.length < 8) {
    lineage.unshift(current);
    current = current.getBaseClass();
  }
  if (current !== owner) return undefined;
  let at = index;
  let holder = owner;
  for (const each of lineage) {
    const constructor = each.getConstructors()[0];
    // A class with no constructor of its own is built with its base's.
    if (constructor === undefined) {
      holder = each;
      continue;
    }
    const handed = superCallOf(each)?.getArguments()[at];
    if (handed === undefined) {
      return { kind: 'unread', expression, why: `${each.getName() ?? 'A class'} hands its base class nothing for the value ${owner.getName() ?? 'it'} keeps.` };
    }
    const held = heldAt(handed);
    if (held.kind === 'parameter' && held.parameter.getParent() === constructor && held.path.length === 0) {
      at = constructor.getParameters().indexOf(held.parameter);
      holder = each;
      continue;
    }
    return held.kind === 'written' ? held : { kind: 'unread', expression: handed, why: `${handed.getText().slice(0, 60)} is not written where ${each.getName() ?? 'the class'} hands it to its base class.` };
  }
  return { kind: 'field', owner: holder, index: at, expression };
};

/** The class a receiver is an instance of, as its type says. */
const classOfReceiver = (receiver: TsNode): ClassDeclaration | undefined => {
  const declaration = receiver
    .getType()
    .getSymbol()
    ?.getDeclarations()
    .find((each) => Node.isClassDeclaration(each));
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/** The declaration a receiver names: the variable, or the field. */
const receiverDeclaration = (receiver: TsNode): TsNode | undefined => {
  const node = unwrapped(receiver);
  const name = Node.isPropertyAccessExpression(node) ? node.getNameNode() : Node.isIdentifier(node) ? node : undefined;
  return name?.getSymbol()?.getDeclarations()[0];
};

/**
 * What an instance was set up with, read where the caller holds it (P286):
 * the argument every call of the setting method on the same variable or
 * field hands it - `this.client.open(this.queueName)` beside
 * `this.client.add(job)`. Two different values, or none, is no answer.
 */
const setOn = (receiver: TsNode, value: Extract<Held, { kind: 'set' }>, call: CallExpression): Held => {
  const declaration = receiverDeclaration(receiver);
  const unread = (why: string): Held => ({ kind: 'unread', expression: receiver, why });
  if (declaration === undefined) return unread(`${receiver.getText().slice(0, 60)} is set up by ${value.method.getName()} somewhere this cannot see.`);
  const answers: Held[] = [];
  for (const setter of callSitesOf(value.method)) {
    const on = receiverOf(setter);
    if (on === undefined || receiverDeclaration(on) !== declaration) continue;
    const argument = setter.getArguments()[value.index];
    if (argument === undefined) return unread(`${setter.getText().slice(0, 60)} hands ${value.method.getName()} nothing.`);
    const held = heldValues(argument, value.path, call);
    // A field of the instance the setter is called from is the caller's own: the same instance.
    answers.push(held.kind === 'field' || held.kind === 'set' ? { ...held, expression: call } : held);
  }
  const [first, ...more] = answers;
  if (first === undefined) return unread(`Nothing calls ${value.method.getName()} on ${receiver.getText().slice(0, 60)}.`);
  const same = more.every((each) => each.kind === first.kind && each.expression.getText() === first.expression.getText());
  return same ? first : unread(`${receiver.getText().slice(0, 60)} is set up with different values by different calls of ${value.method.getName()}.`);
};

const positionOf = (parameter: ParameterDeclaration): number => {
  const owner = parameter.getParent();
  return Node.isParametered(owner) ? owner.getParameters().indexOf(parameter) : -1;
};

/** What an object literal holds under a key, where it is written out. */
const propertyIn = (value: TsNode, key: string): TsNode | undefined | null => {
  const object = unwrapped(value);
  if (!Node.isObjectLiteralExpression(object)) return null;
  for (const property of [...object.getProperties()].reverse()) {
    if (Node.isSpreadAssignment(property)) return null;
    if (Node.isPropertyAssignment(property) && property.getName().replace(/^['"]|['"]$/g, '') === key) return property.getInitializer();
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === key) return property.getNameNode();
  }
  return undefined;
};

const receiverOf = (call: CallExpression): TsNode | undefined => {
  const callee = unwrapped(call.getExpression());
  return Node.isPropertyAccessExpression(callee) ? unwrapped(callee.getExpression()) : undefined;
};

/** The construction a binding was initialised with, where it was: `const queue = new JobQueue(...)`. */
const constructionOf = (receiver: TsNode, owner: ClassDeclaration): TsNode[] | undefined => {
  const declaration = Node.isIdentifier(receiver) || Node.isPropertyAccessExpression(receiver) ? receiver.getSymbol()?.getDeclarations()[0] : undefined;
  const initial =
    declaration !== undefined && (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration))
      ? declaration.getInitializer()
      : undefined;
  if (initial === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
  const made = unwrapped(initial);
  if (!Node.isNewExpression(made)) return undefined;
  const callee = made.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
  return name === owner.getName() ? made.getArguments() : undefined;
};

/** What a function or a decorator factory answers with: its concise body or its one `return`. */
const answerOf = (fn: TsNode): TsNode | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return body;
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(
    (statement) => statement.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node)) === fn,
  );
  return returns.length === 1 ? returns[0]?.getExpression() : undefined;
};

/** The function a name stands for: a declaration, or a `const` holding an arrow. */
const functionNamed = (name: TsNode): TsNode | undefined => {
  const symbol = name.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration)) {
    const initial = declaration.getInitializer();
    return initial !== undefined && (Node.isArrowFunction(initial) || Node.isFunctionExpression(initial)) ? initial : undefined;
  }
  return undefined;
};

/** Parameters of a factory, each bound to what the call of it was handed. */
type Bindings = ReadonlyMap<TsNode, TsNode>;

/** An expression with every parameter of a factory it names replaced by what the factory was handed. */
const bound = (expression: TsNode, bindings: Bindings): TsNode => {
  const node = unwrapped(expression);
  if (!Node.isIdentifier(node)) return expression;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  return declaration === undefined ? expression : (bindings.get(declaration) ?? expression);
};

/** The framework's own `Inject`, by the package it is imported from. */
const isInject = (callee: TsNode): boolean =>
  Node.isIdentifier(callee) && importOf(callee)?.exported === 'Inject' && importOf(callee)?.module === '@nestjs/common';

/**
 * The token a parameter decorator asks the container for, with the arguments
 * of every factory it was built by bound: `@InjectJobQueue(QueueName.mail)`
 * over `(name) => Inject(queueToken(name))` asks for `queueToken(name)` with
 * `name` bound to `QueueName.mail`.
 */
const injectedToken = (call: CallExpression, bindings: Bindings, depth = 0): { token: TsNode; bindings: Bindings } | undefined => {
  if (depth > MOST_LINKS) return undefined;
  const callee = unwrapped(call.getExpression());
  const [first] = call.getArguments();
  if (isInject(callee)) return first === undefined ? undefined : { token: first, bindings };
  if (!Node.isIdentifier(callee)) return undefined;
  const factory = functionNamed(callee);
  if (factory === undefined || !Node.isParametered(factory)) return undefined;
  const next = new Map(bindings);
  for (const [index, parameter] of factory.getParameters().entries()) {
    const argument = call.getArguments()[index];
    if (argument !== undefined) next.set(parameter, bound(argument, bindings));
  }
  const answer = answerOf(factory);
  const inner = answer === undefined ? undefined : unwrapped(answer);
  return inner !== undefined && Node.isCallExpression(inner) ? injectedToken(inner, next, depth + 1) : undefined;
};

/** The constructor arguments of an instance a provider record builds, where it builds one of this class. */
const builtBy = (record: TsNode, owner: ClassDeclaration): TsNode[] | undefined => {
  if (!Node.isObjectLiteralExpression(record)) return undefined;
  const factory = propertyIn(record, 'useFactory');
  const value = propertyIn(record, 'useValue');
  const made = factory !== undefined && factory !== null ? answerOf(unwrapped(factory)) : value ?? undefined;
  if (made === undefined || made === null) return undefined;
  const construction = unwrapped(made);
  if (!Node.isNewExpression(construction)) return undefined;
  const callee = construction.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
  return name === owner.getName() ? construction.getArguments() : undefined;
};

/** The provider record a `provide:` value is written in. */
const recordOf = (provided: TsNode): TsNode | undefined => {
  const property = provided.getParent();
  if (!Node.isPropertyAssignment(property) || property.getName() !== 'provide' || property.getInitializer() !== provided) return undefined;
  return property.getParent();
};

const sameBinding = (left: TsNode, right: TsNode): boolean => {
  const a = unwrapped(left);
  const b = unwrapped(right);
  if (!Node.isIdentifier(a) || !Node.isIdentifier(b)) return false;
  const declaration = a.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && declaration === b.getSymbol()?.getDeclarations()[0];
};

const sameValue = (left: TsNode, right: TsNode): boolean => {
  const a = evaluateExpression(left);
  const b = evaluateExpression(right);
  return a.resolved && b.resolved && a.value === b.value;
};

/**
 * What the instance a token provides was constructed with at `index`, as the
 * provider that builds it says.
 *
 * A token made by a function - `queueToken(name)` - is provided wherever that
 * function makes the token a record provides: `{ provide: queueToken(name),
 * useFactory: (driver) => new JobQueue(driver, name) }`. Where the instance is
 * built with the very value the token was made from, the instance asked for by
 * `queueToken(QueueName.mail)` holds `QueueName.mail`; where it is built with a
 * value written out, it holds that value, for the token made from the same.
 * A token that is a constant is provided wherever the constant is `provide:`d.
 * Every provider found has to agree; one that says otherwise, or none, is no
 * answer.
 */
const providedArgument = (token: TsNode, bindings: Bindings, owner: ClassDeclaration, index: number): TsNode | undefined => {
  const written = unwrapped(token);
  const answers: TsNode[] = [];
  if (Node.isCallExpression(written)) {
    const maker = unwrapped(written.getExpression());
    const [made] = written.getArguments();
    if (!Node.isIdentifier(maker) || made === undefined) return undefined;
    const asked = bound(made, bindings);
    const declaration = (maker.getSymbol()?.getAliasedSymbol() ?? maker.getSymbol())?.getDeclarations()[0];
    const named = declaration !== undefined && (Node.isFunctionDeclaration(declaration) || Node.isVariableDeclaration(declaration)) ? declaration : undefined;
    if (named === undefined) return undefined;
    for (const reference of named.findReferencesAsNodes()) {
      const call = reference.getParent();
      if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== reference) continue;
      const record = recordOf(call);
      const built = record === undefined ? undefined : builtBy(record, owner);
      const held = built?.[index];
      const [key] = call.getArguments();
      if (held === undefined || key === undefined) continue;
      if (sameBinding(held, key)) answers.push(asked);
      else if (sameValue(key, asked)) answers.push(held);
    }
  } else if (Node.isIdentifier(written) || Node.isPropertyAccessExpression(written)) {
    const symbol = written.getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
    if (declaration === undefined || !Node.isReferenceFindable(declaration)) return undefined;
    for (const reference of declaration.findReferencesAsNodes()) {
      const at = Node.isPropertyAccessExpression(reference.getParent()) ? reference.getParentOrThrow() : reference;
      const record = recordOf(at);
      const held = record === undefined ? undefined : builtBy(record, owner)?.[index];
      if (held !== undefined) answers.push(held);
    }
  }
  if (answers.length === 0) return undefined;
  const [first] = answers;
  return answers.every((answer) => answer === first || sameValue(answer, first as TsNode) || answer.getText() === first?.getText()) ? first : undefined;
};

/** What the instance a call is made on was constructed with at `index`. */
const instanceValue = (receiver: TsNode, owner: ClassDeclaration, index: number, di: DiMap, depth = 0): Held => {
  // An instance of a class extending the owner holds what that class hands
  // its base (P286), or what it was itself built with.
  const typed = classOfReceiver(receiver);
  if (typed !== undefined && typed !== owner && depth < 4) {
    const through = heldThroughSuper(typed, owner, index, receiver);
    if (through?.kind === 'field' && through.owner !== owner) return instanceValue(receiver, through.owner, through.index, di, depth + 1);
    if (through !== undefined && through.kind !== 'field') return through;
  }
  const made = constructionOf(receiver, owner);
  if (made !== undefined) {
    const argument = made[index];
    return argument === undefined
      ? { kind: 'unread', expression: receiver, why: `${receiver.getText()} is constructed without the value its queue is.` }
      : heldAt(argument);
  }
  const holder = receiver.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  const provider =
    holder !== undefined && Node.isPropertyAccessExpression(receiver) && Node.isThisExpression(unwrapped(receiver.getExpression()))
      ? di.lookup(holder, receiver.getName())?.parameter
      : undefined;
  for (const decorator of provider?.getDecorators() ?? []) {
    const call = decorator.getCallExpression();
    const asked = call === undefined ? undefined : injectedToken(call, new Map());
    if (asked === undefined) continue;
    const argument = providedArgument(asked.token, asked.bindings, owner, index);
    if (argument !== undefined) return heldAt(argument);
  }
  return {
    kind: 'unread',
    expression: receiver,
    why:
      `${receiver.getText()} is an instance of ${owner.getName() ?? 'a class'} and its queue is what the instance was built with; ` +
      'no provider of it that builds the instance, and no construction of it, could be read.',
  };
};

/**
 * One value one call further out, the call being one of `holder`'s.
 *
 * A value that waits on another function than the one this call runs is
 * decided by somebody else, and no call here can say what: it is left as it
 * was read where it is written.
 */
const stepped = (value: Held, call: CallExpression, holder: Forwarder, di: DiMap): Held => {
  if (value.kind === 'written' || value.kind === 'unread') return value;
  if (holderAt(value, value.expression) !== holder) {
    return { kind: 'unread', expression: value.expression, why: `${value.expression.getText().slice(0, 60)} is decided by a caller of another function.` };
  }
  if (value.kind === 'field' || value.kind === 'set') {
    const receiver = receiverOf(call);
    if (isSelf(receiver)) {
      // `this.add(...)` from another method of the same instance: still the
      // field, now waiting on whoever calls that method - unless that method
      // is a subclass's, whose constructor decides it (P286).
      const cls = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const decided = value.kind === 'field' && cls !== undefined && cls !== value.owner ? heldThroughSuper(cls, value.owner, value.index, call) : undefined;
      return decided ?? { ...value, expression: call };
    }
    if (value.kind === 'set') return setOn(receiver as TsNode, value, call);
    return instanceValue(receiver as TsNode, value.owner, value.index, di);
  }
  const position = positionOf(value.parameter);
  const argument: TsNode | undefined = call.getArguments()[position] ?? value.parameter.getInitializer();
  if (argument === undefined || Node.isSpreadElement(argument)) {
    return { kind: 'unread', expression: call, why: `${call.getText().slice(0, 60)} hands nothing for ${value.parameter.getName()}.` };
  }
  return heldValues(argument, value.path, call);
};

/** A function as a reader names it: `Class.method`, or the function's own name. */
const labelOf = (holder: Forwarder): string => {
  const name = holder.getName();
  if (Node.isVariableDeclaration(holder) || Node.isFunctionDeclaration(holder)) return name ?? '?';
  const owner = holder.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
  return owner === undefined ? (name ?? '?') : `${owner}.${name ?? '?'}`;
};

/** One place a publish is decided, and how it got there. */
export interface ForwardedSite {
  /** The call the values were decided at: where the publish is drawn. */
  readonly site: CallExpression;
  /** Each value as it is there, in the order it was asked for. */
  readonly values: readonly (Held | undefined)[];
  /** The calls passed through, innermost first, ending with `site`. */
  readonly hops: readonly CallExpression[];
  /** Whether a call on the way may run another implementation instead (R158). */
  readonly undecided: boolean;
  /** The functions the values were handed out of, innermost first: `JobQueueService.add`. */
  readonly through: readonly string[];
}

export interface ForwardedPublish {
  readonly sites: readonly ForwardedSite[];
  /** Whether the call where it is written still answers for it: nothing calls it, or the walk stopped short. */
  readonly here: boolean;
}

/**
 * Every call a publish's values are decided at, followed out from the call
 * the broker's client is called with.
 *
 * Each value is followed out along the same calls, so the queue, the job and
 * the message read at one site are the ones one caller handed in. A call
 * nothing calls is where its values stop: a chain nobody runs stands for
 * nobody and is dropped, as a forwarded request is. A call that may run
 * another implementation of the method instead is followed, and said to be:
 * a queue the caller names is the queue whichever runs.
 */
export const forwardedPublish = (values: readonly (Held | undefined)[], di: DiMap, deciding = 1, addressed = 1): ForwardedPublish => {
  /** The value a site waits on: the address while it waits, then the job (P271). */
  const decider = (current: readonly (Held | undefined)[]): Held | undefined =>
    current.slice(0, deciding).find((value): value is Held => value !== undefined && waits(value));
  const sites: ForwardedSite[] = [];
  let short = false;
  const walk = (
    current: readonly (Held | undefined)[],
    hops: readonly CallExpression[],
    through: readonly string[],
    undecided: boolean,
  ): void => {
    if (sites.length >= MOST_SITES) {
      short = true;
      return;
    }
    const address = decider(current);
    const holder = address === undefined ? undefined : holderAt(address, address.expression);
    if (holder === undefined || hops.length >= MOST_HOPS) {
      if (hops.length === 0) short = true;
      else sites.push({ site: hops.at(-1) as CallExpression, values: current, hops, through, undecided });
      return;
    }
    const callers = callSitesOf(holder).filter((caller) => !hops.includes(caller));
    if (callers.length === 0 && hops.length === 0) short = true;
    // The queue was decided at the last call and only the job waits on a
    // function nothing calls: drawn there, its job unread (P271).
    if (callers.length === 0 && hops.length > 0 && !current.slice(0, addressed).includes(address)) {
      sites.push({ site: hops.at(-1) as CallExpression, values: current, hops, through, undecided });
    }
    for (const caller of callers) {
      const maybe = Node.isMethodDeclaration(holder) || Node.isPropertyDeclaration(holder) ? dispatchOf(caller, holder) === 'undecided' : false;
      const next = current.map((value) => (value === undefined ? undefined : stepped(value, caller, holder, di)));
      const path = [...hops, caller];
      const named = [...through, labelOf(holder)];
      // The address decides where the publish is drawn, and then the job
      // where it is decided further out (P271): once both are written, a
      // message still waiting is read as the caller hands it.
      if (decider(next) !== undefined) walk(next, path, named, undecided || maybe);
      else sites.push({ site: caller, values: next, hops: path, through: named, undecided: undecided || maybe });
    }
  };
  walk(values, [], [], false);
  return { sites, here: short || sites.length === 0 };
};
