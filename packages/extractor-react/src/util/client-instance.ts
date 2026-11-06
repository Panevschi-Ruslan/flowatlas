import { declarationOf, isPlatformProvided } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { CLIENT_FACTORIES, type ClientFactory } from '../clients.js';
import { functionsOf, rewritesOf, type Rewrite, type RewriteReading } from './request-rewrite.js';
import { analyzeClientBase, isSomewhere, type ApiUrl, type Bindings } from './url.js';

/**
 * An instance of an installed client, and the base it was made with (P239).
 *
 * `axios.create({ baseURL: import.meta.env.VITE_API_URL })` is written once, in
 * one module, and every screen imports the result and writes `/orders` through
 * it. The address the request reaches is the two together, and until this was
 * read the graph recorded `/orders` alone - an address that joins a route only
 * by its path, and joins nothing where two services serve it. The fix is R114's:
 * the base is read where it is written and folded into the address the graph
 * records, so the linker has one string to compare.
 */
export interface ClientInstance {
  readonly factory: ClientFactory;
  /** The base every request through it is written under, when one was read. */
  readonly base?: ApiUrl;
  /**
   * Where a base was written and could not be read, and why, when that is what
   * happened. The request then keeps the path it writes, and the line is said
   * once.
   */
  readonly unread?: { readonly at: TsNode; readonly why: string };
  /**
   * What the functions the client runs before every request through it do to
   * the address, when they were read and agree (P244): an interceptor
   * registered on it afterwards, a hook among the options it was made with.
   */
  readonly rewrite?: Rewrite;
  /**
   * Where such a function rewrites the address and nothing certain could be
   * taken from it, and why. The instance keeps the base it was made with, which
   * is what every request the function leaves alone goes out under.
   */
  readonly rewriteUnread?: { readonly at: TsNode; readonly why: string };
  /** Every reading of such functions, before they are put together. */
  readonly readings?: readonly RewriteReading[];
}

export interface InstanceOptions {
  readonly sharedPackages?: readonly string[];
  /** The repository's own source files, where `defaults` assignments are looked for. */
  readonly files: () => readonly SourceFile[];
}

/** How many names, functions and parents an instance is followed through before giving up. */
const DEPTH = 6;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

/** The package a name is imported from, read off its import rather than its type. */
const importedFrom = (node: TsNode): string | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement !== undefined) return statement.getModuleSpecifierValue();
  }
  return undefined;
};

/**
 * The client a name is the module of, when it is: imported from the client's
 * package, or one of the names the framework provides without an import.
 *
 * Read off the import and not the type, so a clone with nothing installed reads
 * the same instance a built one does. A name declared in the repository is never
 * the module, whatever it is called.
 */
export const factoryOfModule = (node: TsNode): ClientFactory | undefined => {
  const target = unwrap(node);
  if (!Node.isIdentifier(target)) return undefined;
  const from = importedFrom(target);
  if (from !== undefined) return CLIENT_FACTORIES.find((factory) => factory.modules.includes(from));
  const name = target.getText();
  return CLIENT_FACTORIES.find((factory) => factory.globals?.includes(name) === true && isPlatformProvided(target));
};

/** The one expression a function of the repository answers with, when it has one. */
const returnedBy = (fn: TsNode): TsNode | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return body;
  const returned = body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node)) === fn)
    .map((statement) => statement.getExpression());
  return returned.length === 1 ? returned[0] : undefined;
};

/** The function a declaration holds, when it is one. */
const functionOf = (declaration: TsNode | undefined): TsNode | undefined => {
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration)) {
    const value = declaration.getInitializer();
    return value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) ? value : undefined;
  }
  return undefined;
};

/** The expression a field of a class is given, at its declaration or once in the constructor. */
const fieldValue = (declaration: TsNode): TsNode | undefined => {
  if (!Node.isPropertyDeclaration(declaration)) return undefined;
  const written = declaration.getInitializer();
  if (written !== undefined) return written;
  const cls = declaration.getParent();
  if (!Node.isClassDeclaration(cls) && !Node.isClassExpression(cls)) return undefined;
  const name = declaration.getName();
  const assigned = cls
    .getConstructors()
    .flatMap((constructor) => constructor.getDescendantsOfKind(SyntaxKind.BinaryExpression))
    .filter((binary) => {
      const left = binary.getLeft();
      return (
        binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        Node.isPropertyAccessExpression(left) &&
        Node.isThisExpression(left.getExpression()) &&
        left.getName() === name
      );
    });
  return assigned.length === 1 ? assigned[0]?.getRight() : undefined;
};

/**
 * The expression a declaration stands for: a `const`, a field, a key of an
 * object, a default export. A parameter, or anything else handed in from
 * outside, stands for nothing that can be read here.
 */
const valueOfDeclaration = (declaration: TsNode): TsNode | undefined => {
  if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
  if (Node.isPropertyAssignment(declaration)) return declaration.getInitializer();
  if (Node.isExportAssignment(declaration)) return declaration.getExpression();
  return fieldValue(declaration);
};

/** The value written for a key of an object, read through the spreads in it (the last one written wins). */
type Found = { readonly kind: 'value'; readonly node: TsNode } | { readonly kind: 'absent' } | { readonly kind: 'unread'; readonly at: TsNode };

/**
 * The object an options argument is, when it is one that can be read: written
 * in place, a `const` holding one, or a parameter a caller handed one to.
 */
const objectOf = (node: TsNode, bindings: Bindings | undefined, depth: number): ObjectLiteralExpression | undefined => {
  if (depth > DEPTH) return undefined;
  const target = unwrap(node);
  if (Node.isObjectLiteralExpression(target)) return target;
  if (!Node.isIdentifier(target)) return undefined;
  const declaration = target.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  const bound = bindings?.values.get(declaration);
  if (bound !== undefined) return objectOf(bound, bindings?.under, depth + 1);
  const value = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  return value === undefined ? undefined : objectOf(value, bindings, depth + 1);
};

const keyIn = (object: ObjectLiteralExpression, key: string, bindings: Bindings | undefined, depth: number): Found => {
  const properties = object.getProperties();
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];
    if (property === undefined) continue;
    if (Node.isPropertyAssignment(property) && property.getName().replace(/^['"]|['"]$/g, '') === key) {
      const value = property.getInitializer();
      return value === undefined ? { kind: 'unread', at: property } : { kind: 'value', node: value };
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === key) {
      return { kind: 'value', node: property.getNameNode() };
    }
    // A hook written as a method, `onRequest({ options }) { ... }` (P244).
    if (Node.isMethodDeclaration(property) && property.getName() === key) return { kind: 'value', node: property };
    if (Node.isSpreadAssignment(property)) {
      const spread = objectOf(property.getExpression(), bindings, depth + 1);
      if (spread === undefined) return { kind: 'unread', at: property };
      const inner = keyIn(spread, key, bindings, depth + 1);
      if (inner.kind !== 'absent') return inner;
    }
  }
  return { kind: 'absent' };
};

/**
 * What a name written for a base stands for, through what callers bound it to.
 *
 * `{ baseURL }` written short names a binding of the same name, which the
 * checker answers for under a symbol of its own; and a factory of the
 * repository's own, `createApi(import.meta.env.VITE_API)`, hands its base in as
 * a parameter. Both are settled here so the base reader is asked about the
 * expression that was actually written.
 */
const settled = (node: TsNode, bindings: Bindings | undefined): { node: TsNode; bindings?: Bindings } => {
  let current = unwrap(node);
  let under = bindings;
  for (let depth = 0; depth < DEPTH; depth += 1) {
    const parent = current.getParent();
    const symbol =
      parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === current
        ? parent.getValueSymbol()
        : Node.isIdentifier(current)
          ? current.getSymbol()
          : undefined;
    const declaration = symbol?.getDeclarations()[0];
    const bound = declaration === undefined ? undefined : under?.values.get(declaration);
    if (bound === undefined) {
      // A short key naming a `const` is the `const`'s value, read as one.
      if (parent !== undefined && Node.isShorthandPropertyAssignment(parent) && declaration !== undefined && Node.isVariableDeclaration(declaration)) {
        const value = declaration.getInitializer();
        if (value !== undefined) return { node: value, ...(under === undefined ? {} : { bindings: under }) };
      }
      return { node: current, ...(under === undefined ? {} : { bindings: under }) };
    }
    current = unwrap(bound);
    under = under?.under;
  }
  return { node: current, ...(under === undefined ? {} : { bindings: under }) };
};

/**
 * The declaration a call that makes an instance is the value of: a `const`, a
 * field (at its declaration or assigned once in the constructor), a key of an
 * object, a default export. The same declaration a name of the instance leads
 * back to, which is how a `defaults` assignment finds the instance it sets.
 */
const holderAt = (made: CallExpression): TsNode | undefined => {
  let at: TsNode = made;
  let parent = at.getParent();
  while (
    parent !== undefined &&
    (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent) || Node.isNonNullExpression(parent))
  ) {
    at = parent;
    parent = at.getParent();
  }
  if (parent === undefined) return undefined;
  if (Node.isVariableDeclaration(parent) || Node.isPropertyDeclaration(parent) || Node.isPropertyAssignment(parent) || Node.isExportAssignment(parent)) {
    return parent;
  }
  if (Node.isBinaryExpression(parent) && parent.getRight() === at && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    return declarationOf(parent.getLeft());
  }
  return undefined;
};

/**
 * What a member chain is called on, when a callee spells the chain:
 * `api.interceptors.request.use` is `api` for `interceptors / request / use`.
 */
const ownerOfChain = (callee: TsNode, chain: readonly string[]): TsNode | undefined => {
  let current = unwrap(callee);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!Node.isPropertyAccessExpression(current) || current.getName() !== chain[index]) return undefined;
    current = unwrap(current.getExpression());
  }
  return current;
};

/** The bindings a call to a function of the repository makes of its parameters. */
const bindingsAt = (call: CallExpression, fn: TsNode, under: Bindings | undefined): Bindings | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return under;
  const values = new Map<TsNode, TsNode>();
  const args = call.getArguments();
  fn.getParameters().forEach((parameter, index) => {
    const argument = args[index];
    if (argument !== undefined) values.set(parameter, argument);
  });
  return values.size === 0 ? under : { values, ...(under === undefined ? {} : { under }) };
};

/**
 * The instances a repository makes, and the base of each, asked once.
 *
 * Reached from every request written through an instance, so a declaration is
 * answered once and the whole repository is searched for `defaults` assignments
 * once, and only the first time any instance is asked.
 */
export const clientInstances = (options: InstanceOptions) => {
  const { sharedPackages = [] } = options;
  const byDeclaration = new Map<TsNode, ClientInstance | null>();

  /**
   * `x.defaults.baseURL = ...` and `x.interceptors.request.use(fn)` anywhere in
   * the repository, by the declaration `x` holds: what is done to an instance
   * after it is made (P239, P244).
   */
  let assignments: Map<TsNode | ClientFactory, TsNode[]> | undefined;
  let registrations: Map<TsNode | ClientFactory, Array<{ factory: ClientFactory; fn: TsNode }>> | undefined;
  const scan = (): void => {
    if (assignments !== undefined) return;
    assignments = new Map();
    const registered = new Map<TsNode | ClientFactory, Array<{ factory: ClientFactory; fn: TsNode }>>();
    registrations = registered;
    const keys = new Set(CLIENT_FACTORIES.flatMap((factory) => (factory.defaults === undefined ? [] : [`${factory.defaults}.${factory.baseKey}`])));
    const chains = CLIENT_FACTORIES.flatMap((factory) => (factory.rewrites?.registeredAt === undefined ? [] : [{ factory, chain: factory.rewrites.registeredAt }]));
    for (const file of options.files()) {
      const text = file.getFullText();
      if (chains.some(({ chain }) => chain.every((name) => text.includes(name)))) {
        for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          for (const { factory, chain } of chains) {
            const owner = ownerOfChain(call.getExpression(), chain);
            if (owner === undefined) continue;
            const module = factoryOfModule(owner);
            if (module !== undefined && module !== factory) continue;
            const key = module ?? holderOf(owner);
            const [handed] = call.getArguments();
            if (key === undefined || handed === undefined) continue;
            for (const fn of functionsOf(handed)) registered.set(key, [...(registered.get(key) ?? []), { factory, fn }]);
          }
        }
      }
      if ([...keys].some((key) => text.includes(key))) {
        for (const binary of file.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
          if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
          const left = binary.getLeft();
          if (!Node.isPropertyAccessExpression(left)) continue;
          const defaults = left.getExpression();
          if (!Node.isPropertyAccessExpression(defaults)) continue;
          const owner = defaults.getExpression();
          const module = factoryOfModule(owner);
          const factory = module ?? CLIENT_FACTORIES.find((each) => each.defaults === defaults.getName());
          if (factory?.defaults !== defaults.getName() || factory.baseKey !== left.getName()) continue;
          const key = module ?? holderOf(owner);
          if (key === undefined) continue;
          assignments.set(key, [...(assignments.get(key) ?? []), binary.getRight()]);
        }
      }
    }
  };
  const defaultsOf = (holder: TsNode | ClientFactory): readonly TsNode[] => {
    scan();
    return assignments?.get(holder) ?? [];
  };
  /** What the functions registered on an instance afterwards do to its address (P244). */
  const registeredOn = (holder: TsNode | ClientFactory, factory: ClientFactory): RewriteReading[] => {
    scan();
    return (registrations?.get(holder) ?? [])
      .filter((each) => each.factory === factory)
      .flatMap((each) => rewritesOf(each.fn, factory, (node) => readBase(node, undefined)));
  };

  /** The declaration that holds an instance a name is, the one whose value makes it. */
  const holderOf = (node: TsNode): TsNode | undefined => {
    let current = unwrap(node);
    for (let depth = 0; depth < DEPTH; depth += 1) {
      if (!Node.isIdentifier(current) && !Node.isPropertyAccessExpression(current)) return undefined;
      const declaration = declarationOf(current);
      if (declaration === undefined) return undefined;
      const value = valueOfDeclaration(declaration);
      if (value === undefined) return undefined;
      const inner = unwrap(value);
      if (!Node.isIdentifier(inner) && !Node.isPropertyAccessExpression(inner)) return declaration;
      current = inner;
    }
    return undefined;
  };

  /** A base written for an instance, read as every other base is. */
  const readBase = (written: TsNode, bindings: Bindings | undefined): ApiUrl | 'unread' => {
    const at = settled(written, bindings);
    const base = analyzeClientBase(at.node, { sharedPackages, ...(at.bindings === undefined ? {} : { bindings: at.bindings }) });
    return isSomewhere(base) ? base : 'unread';
  };

  /** The base the options an instance is made with write, or what stopped them being read. */
  const baseIn = (
    factory: ClientFactory,
    call: CallExpression,
    bindings: Bindings | undefined,
  ): { base?: ApiUrl; unread?: ClientInstance['unread']; written: boolean } => {
    const [config] = call.getArguments();
    if (config === undefined) return { written: false };
    const object = objectOf(config, bindings, 0);
    if (object === undefined) {
      return { written: true, unread: { at: call, why: `the options ${call.getExpression().getText()} is made with could not be read` } };
    }
    const found = keyIn(object, factory.baseKey, bindings, 0);
    if (found.kind === 'absent') return { written: false };
    if (found.kind === 'unread') {
      return { written: true, unread: { at: found.at, why: `${factory.baseKey} may be written in what is spread here, and that could not be read` } };
    }
    const base = readBase(found.node, bindings);
    return base === 'unread'
      ? { written: true, unread: { at: found.node, why: `${factory.baseKey} is written and could not be read` } }
      : { written: true, base };
  };

  /**
   * What is done to an instance after it is made: `defaults` assignments to
   * its base (P239), and the functions registered to run before each of its
   * requests (P244), which are kept beside the ones it was made with.
   */
  const withDefaults = (instance: ClientInstance, holder: TsNode | ClientFactory | undefined): ClientInstance => {
    if (holder === undefined) return instance;
    const registered = registeredOn(holder, instance.factory);
    const readings = registered.length === 0 ? instance.readings : [...(instance.readings ?? []), ...registered];
    const kept = readings === undefined ? {} : { readings };
    const based = instance.factory.defaults === undefined ? [] : defaultsOf(holder);
    if (based.length === 0) return { ...instance, ...kept };
    const read = based.map((value) => ({ value, base: readBase(value, undefined) }));
    const unread = read.find((each) => each.base === 'unread');
    if (unread !== undefined) {
      return { factory: instance.factory, ...kept, unread: { at: unread.value, why: `${instance.factory.defaults}.${instance.factory.baseKey} is assigned a value that could not be read` } };
    }
    const bases = [...new Set(read.map((each) => (each.base as ApiUrl).url))];
    if (bases.length > 1) {
      return {
        factory: instance.factory,
        ...kept,
        unread: { at: based[1] as TsNode, why: `${instance.factory.defaults}.${instance.factory.baseKey} is assigned ${bases.length} different values, and which one a request goes out under depends on what ran last` },
      };
    }
    return { factory: instance.factory, ...kept, base: read[0]?.base as ApiUrl };
  };

  /**
   * What the functions among the options an instance is made with do to the
   * address (P244): `onRequest`, `hooks.beforeRequest`. `written` says whether
   * the options name any, which decides what an instance made from an instance
   * keeps of its parent's.
   */
  const hooksIn = (factory: ClientFactory, call: CallExpression, bindings: Bindings | undefined): { readings: RewriteReading[]; written: boolean } => {
    const path = factory.rewrites?.optionAt;
    const [config] = call.getArguments();
    if (path === undefined || config === undefined) return { readings: [], written: false };
    let object = objectOf(config, bindings, 0);
    let found: Found = { kind: 'absent' };
    for (const [index, key] of path.entries()) {
      if (object === undefined) return { readings: [], written: false };
      found = keyIn(object, key, bindings, 0);
      if (found.kind !== 'value') return { readings: [], written: false };
      if (index < path.length - 1) object = objectOf(found.node, bindings, 0);
    }
    if (found.kind !== 'value') return { readings: [], written: false };
    const readings = functionsOf(found.node).flatMap((fn) => rewritesOf(fn, factory, (node) => readBase(node, bindings)));
    return { readings, written: true };
  };

  /** The readings an instance made from an instance keeps of its parent's, beside its own. */
  const inherit = (factory: ClientFactory, own: { readings: RewriteReading[]; written: boolean }, parent: ClientInstance | undefined): readonly RewriteReading[] => {
    const inherited = parent?.readings ?? [];
    switch (factory.rewrites?.inherited ?? 'none') {
      case 'merged':
        return [...inherited, ...own.readings];
      case 'replaced':
        return own.written ? own.readings : inherited;
      case 'none':
        return own.readings;
    }
  };

  /**
   * The readings of every function an instance runs before a request, put
   * together: one rewrite where they agree, a row where any could not be read
   * or two disagree (which runs last is not read).
   */
  const finished = (instance: ClientInstance | undefined): ClientInstance | undefined => {
    const readings = instance?.readings;
    if (instance === undefined || readings === undefined || readings.length === 0) return instance;
    const unread = readings.find((reading) => reading.kind === 'unread');
    if (unread !== undefined && unread.kind === 'unread') return { ...instance, rewriteUnread: { at: unread.at, why: unread.why } };
    const rewrites = readings.flatMap((reading) => (reading.kind === 'rewrite' ? [reading.rewrite] : []));
    const distinct = [...new Map(rewrites.map((rewrite) => [`${rewrite.kind}\0${rewrite.base.url ?? ''}`, rewrite])).values()];
    if (distinct.length > 1) {
      return {
        ...instance,
        rewriteUnread: {
          at: distinct[1]?.at as TsNode,
          why: `${distinct.length} functions ${instance.factory.client.name} runs before every request rewrite the address differently, and which one runs last is not read`,
        },
      };
    }
    const [rewrite] = distinct;
    return rewrite === undefined ? instance : { ...instance, rewrite };
  };

  /** The instance an expression is, followed through names, functions and parents. */
  const instanceOf = (node: TsNode, bindings: Bindings | undefined, depth: number): ClientInstance | undefined => {
    if (depth > DEPTH) return undefined;
    const target = unwrap(node);

    const module = factoryOfModule(target);
    if (module !== undefined) return withDefaults({ factory: module }, module);

    if (Node.isIdentifier(target) || Node.isPropertyAccessExpression(target)) {
      const declaration = declarationOf(target);
      if (declaration === undefined) return undefined;
      if (bindings === undefined && byDeclaration.has(declaration)) return byDeclaration.get(declaration) ?? undefined;
      // Settled before it is read, so a name reached twice on the way is not read twice.
      if (bindings === undefined) byDeclaration.set(declaration, null);
      const value = valueOfDeclaration(declaration);
      const found = value === undefined ? undefined : instanceOf(value, bindings, depth + 1);
      if (bindings === undefined) byDeclaration.set(declaration, found ?? null);
      return found;
    }

    if (!Node.isCallExpression(target)) return undefined;
    const callee = unwrap(target.getExpression());

    // A factory: `axios.create(options)` on the module, or `api.extend(options)`
    // on an instance, which keeps the base it does not write again.
    if (Node.isPropertyAccessExpression(callee)) {
      const receiver = callee.getExpression();
      const fromModule = factoryOfModule(receiver);
      const parent = fromModule === undefined ? instanceOf(receiver, bindings, depth + 1) : undefined;
      const factory = fromModule ?? parent?.factory;
      if (factory === undefined || !factory.methods.includes(callee.getName())) return undefined;
      const own = baseIn(factory, target, bindings);
      const readings = inherit(factory, hooksIn(factory, target, bindings), parent);
      const made: ClientInstance = {
        ...(own.written
          ? { factory, ...(own.base === undefined ? {} : { base: own.base }), ...(own.unread === undefined ? {} : { unread: own.unread }) }
          : { factory, ...(parent?.base === undefined ? {} : { base: parent.base }), ...(parent?.unread === undefined ? {} : { unread: parent.unread }) }),
        ...(readings.length === 0 ? {} : { readings }),
      };
      return withDefaults(made, holderAt(target));
    }

    // A function of the repository's own that makes one, read with what this
    // call hands it: `createApi(import.meta.env.VITE_API)`.
    if (Node.isIdentifier(callee)) {
      const fn = functionOf(declarationOf(callee));
      const returned = fn === undefined ? undefined : returnedBy(fn);
      if (fn === undefined || returned === undefined) return undefined;
      const made = instanceOf(returned, bindingsAt(target, fn, bindings), depth + 1);
      return made === undefined ? undefined : withDefaults(made, holderAt(target));
    }
    return undefined;
  };

  return {
    /** The instance an expression is, when it is one this reader can follow to where it is made. */
    of: (node: TsNode): ClientInstance | undefined => finished(instanceOf(node, undefined, 0)),
  };
};

export type ClientInstances = ReturnType<typeof clientInstances>;
