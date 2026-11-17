import { dirname, join, resolve } from 'node:path';
import type { BinaryExpression, CallExpression, NewExpression, Node as TsNode, PropertyAccessExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind, ts } from 'ts-morph';
import type { Unresolved } from './model/graph.js';
import type { ExtractContext } from './adapters/context.js';
import { ownDirectoryPath } from './config-literal.js';
import { normalizeFilePath } from './ids.js';
import { startLineOf } from './line-numbers.js';
import { isTestName } from './test-files.js';

/**
 * The port a service's server listens on, as its own code says (P250).
 *
 * A request to `http://localhost:3001/orders` is a request to whichever
 * service is listening on 3001 on that machine, and the code that starts the
 * service usually says so in one line: `app.listen(3001)`. Read where it is
 * written, the port is evidence of which service an address on this machine
 * is, beside what the configuration and the repository's setting files say
 * (P77). P245 read it for GraphQL servers; this is the same reading for every
 * server, kept on the repository node, because a server listens once per
 * process and not once per route.
 *
 * A port is told apart by how sure it is. One written as a number - directly,
 * or through a constant - is where the server listens wherever it runs. One a
 * setting falls back to (`process.env.PORT ?? 3001`) is where it listens when
 * nothing sets the setting, and one a library listens on when the code writes
 * none is that library's default: both are where a local run listens, which is
 * the run an address on this machine is written for, and a join made from them
 * says it is a guess.
 *
 * The port is often decided somewhere else than the line that starts the
 * server (P254): handed to the function that starts it (`start(3001)`), read
 * off a settings object (`config.port`) or a settings getter
 * (`config.get('app.port')`, which the adapter that knows the settings library
 * answers), or read from a setting alone (`process.env.PORT`), which the
 * repository's own setting files may fill. Each is followed to where the
 * number is written, and a setting alone is kept with no number, for the
 * linker to fill.
 */

/** Where the repository node keeps the ports its server listens on. */
export const LISTEN_META = 'listen';

/**
 * One port a service's server listens on, and where that is written.
 *
 * `port` is absent only for a port read from a setting alone
 * (`app.listen(process.env.PORT)`): the setting is named, and the number is
 * whatever the repository's setting files give it (P254).
 */
export interface ListenPort {
  readonly port?: number;
  /** Repo-relative POSIX path. */
  readonly file: string;
  readonly line: number;
  /** The setting that moves it elsewhere when it is given: the port is its fallback. */
  readonly setting?: string;
  /** The port the server's library listens on where the code writes none. */
  readonly default?: true;
  /** Where the port is handed to the function that starts the server, `file:line`, when it is (P254). */
  readonly handed?: string;
  /**
   * A front end's development or preview server (P254): it serves the
   * application's pages and its own routes and forwards the rest, so a
   * request it has no route for is not settled by it.
   */
  readonly devServer?: true;
  /**
   * Where the port is read through a merge helper of the repository's own
   * (P305): the call that lays the configuration it is handed over the
   * defaults another module keeps, `file:line`. The port is the defaults'
   * where what is handed in does not write it, so a join made from it says it
   * is a guess.
   */
  readonly merged?: string;
  /**
   * The environment file that gives the setting the port falls back from its
   * value (P305): one the framework loads before it listens (`.env`), or an
   * example of it, read only as a candidate (`default` kept).
   */
  readonly valueFrom?: string;
  /**
   * Where the value the port is read from is written again by something not
   * read (P321), `file:line`: `config = await applyPlugins(config)` whose
   * answer is no function of the repository's own. The port is the value from
   * before that write, so a join made from it says it is a guess.
   */
  readonly rewritten?: string;
}

/** A port read at a node, before it is placed in a file. */
export interface ListenAt {
  readonly port?: number;
  readonly at: TsNode;
  readonly setting?: string;
  readonly default?: true;
  /** The call that hands the port to the function starting the server (P254). */
  readonly handedAt?: TsNode;
  readonly devServer?: true;
  /** The merge helper's call the port is read through (P305). */
  readonly mergedAt?: TsNode;
  /** The write not read that the value the port is read from passes (P321). */
  readonly rewrittenAt?: TsNode;
}

/** What an expression says of a port: the number, and the setting it falls back from. */
export interface WrittenPort {
  readonly port?: number;
  readonly setting?: string;
  /** The merge helper's call the port is read through, where it is (P305). */
  readonly mergedAt?: TsNode;
}

/**
 * What a reader that knows a settings library adds to the reading of a port
 * (P254): the value a settings getter answers for a key, `config.get('app.port')`,
 * where the library builds it from a factory or a schema the core does not know.
 */
export interface PortReading {
  readonly settingOf?: (call: CallExpression, key: string) => WrittenPort | undefined;
  /**
   * The value a property of a settings object answers where the checker
   * cannot say what the object is (P257): `config.port` of an object a
   * settings library hands in by a token, typed by a type of that library.
   */
  readonly propertyOf?: (access: PropertyAccessExpression) => WrittenPort | undefined;
}

/** Whether a port is written as a number the server listens on wherever it runs. */
export const literalPort = (port: Pick<ListenPort, 'setting' | 'default' | 'merged' | 'rewritten'>): boolean =>
  port.setting === undefined && port.default !== true && port.merged === undefined && port.rewritten === undefined;

/**
 * Whether a setting is named as a variable of the environment is: `PORT`,
 * `ORDERS_PORT`. A port read from a setting alone is kept only where it is,
 * since a key of a settings object (`app.port`) is filled from nothing the
 * repository's files say.
 */
export const isEnvironmentName = (setting: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(setting);

const DEPTH = 6;

/** The value a property's declaration gives it: `port: 3001`, or `{ port }` naming a constant. */
const propertyValue = (declaration: TsNode): TsNode | undefined => {
  if (Node.isPropertyAssignment(declaration)) return declaration.getInitializer();
  if (Node.isShorthandPropertyAssignment(declaration)) {
    const value = declaration.getValueSymbol()?.getDeclarations()[0];
    return value !== undefined && Node.isVariableDeclaration(value) ? value.getInitializer() : undefined;
  }
  return undefined;
};

/** What following an expression passed through on the way, for the port read at its end to say (P305, P315). */
interface Trail {
  /** The merge helper's call a value was read through. */
  mergedAt?: TsNode;
  /** The call that hands the value in, where what one caller hands is what was read (P315). */
  handedAt?: TsNode;
  /** The other values the expression may hold, where it holds more than one: each caller's, each write's (P315). */
  others?: Candidate[];
  /** A module loaded from a path decided at run time, that the value was to come from (P315). */
  unreadAt?: TsNode;
  /** A write of a variable or a property the value is read from, whose own value is not read (P321). */
  rewrittenAt?: TsNode;
  /** Where the value is read: the call that starts the server, for a key of an object written after it is declared (P327). */
  readAt?: TsNode;
}

/** One value an expression may hold, and how it was reached (P315). */
interface Candidate {
  readonly value: TsNode;
  readonly mergedAt?: TsNode;
  readonly handedAt?: TsNode;
}

/** The first of several values, as the one followed; the others are kept on the trail for the reader to follow too (P315). */
const adopt = (found: readonly Candidate[], trail: Trail | undefined): TsNode | undefined => {
  const [first, ...rest] = found;
  if (first === undefined) return undefined;
  if (trail !== undefined) {
    if (first.mergedAt !== undefined) trail.mergedAt ??= first.mergedAt;
    if (first.handedAt !== undefined) trail.handedAt ??= first.handedAt;
    if (rest.length > 0) trail.others = [...(trail.others ?? []), ...rest];
  }
  return first.value;
};

/** The value a member's declaration gives it: a property of a literal object, or an exported constant read through its module (`cfg.port`). */
const memberValue = (declaration: TsNode): TsNode | undefined =>
  propertyValue(declaration) ?? (Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined);

/** An expression through the names and wrappers in front of it: a constant's value. */
const followed = (node: TsNode | undefined, depth = 0, trail?: Trail): TsNode | undefined => {
  if (node === undefined || depth > DEPTH) return node;
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node)) {
    return followed(node.getExpression(), depth + 1, trail);
  }
  // `config.port`, `settings.server.port`: the property where a literal
  // object declares it, in this file or another (P254). `process.env.PORT` is
  // a setting, read as one below.
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() !== 'process.env') {
    // A property written after it is declared, or one of a value that is, is
    // what its writes say rather than what its declaration does (P321).
    if (heldIn(node) === undefined) {
      for (const declaration of node.getNameNode().getSymbol()?.getDeclarations() ?? []) {
        const value = memberValue(declaration);
        if (value !== undefined) return followed(value, depth + 1, trail);
      }
    }
    // `mergeConfig(given).apiOptions.port`: the key of what a merge helper answers (P305),
    // `getConfig().apiOptions.port` of what a function returns or a module variable holds (P315).
    const merged = throughMerge(node, [], depth, trail);
    return merged ?? node;
  }
  if (!Node.isIdentifier(node)) return node;
  const symbol = node.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    // A variable the repository's own code writes: each value written (P315),
    // or the one written last before the read in a function (P321).
    if (holderOf(declaration) !== undefined) {
      const value = adopt(valuesAt(node, [], 0, walkFrom(trail)).found, trail);
      return value === undefined || value === node ? node : followed(value, depth + 1, trail);
    }
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return followed(initializer, depth + 1, trail);
    }
    // `const { port } = config`: the property of the object it is taken from.
    const taken = destructured(declaration, depth, trail);
    if (taken !== undefined) return taken;
  }
  return node;
};

/** The value a name destructured from a literal object is: `const { port } = { port: 3001 }`. */
const destructured = (element: TsNode, depth: number, trail?: Trail): TsNode | undefined => {
  if (!Node.isBindingElement(element)) return undefined;
  const pattern = element.getParent();
  const declaration = pattern.getParent();
  if (!Node.isObjectBindingPattern(pattern) || !Node.isVariableDeclaration(declaration)) return undefined;
  const key = element.getPropertyNameNode()?.getText() ?? element.getName();
  const initializer = declaration.getInitializer();
  // `const { port } = mergeConfig(given).apiOptions`: read at the whole path, so
  // a key the given object leaves out of the object it writes is the defaults' (P305).
  const merged = initializer === undefined ? undefined : throughMerge(initializer, [key], depth, trail);
  if (merged !== undefined) return merged;
  const from = followed(initializer, depth + 1, trail);
  if (from === undefined || !Node.isObjectLiteralExpression(from)) return undefined;
  const property = from.getProperty(key);
  const value = property === undefined ? undefined : propertyValue(property);
  return value === undefined ? undefined : followed(value, depth + 1, trail);
};

/**
 * A configuration merged over defaults by a helper of the repository's own
 * (P305): `mergeConfig(given)`, whose body lays `given` over a `defaults`
 * object another module keeps, or `mergeConfig(defaults, given)`, handed both.
 * The bootstrap that starts the server often reads its port off the result
 * (`const { port } = mergeConfig(given).apiOptions`), and the number is
 * written only in the defaults.
 *
 * A function is such a helper where it is the repository's own (a body in a
 * file of the repository), takes at least one argument, and merges: its body
 * spreads, calls `Object.assign`, walks the keys of what it is handed, or
 * calls itself. What it answers is the objects it lays over each other, in
 * order: every object literal outside it its body names (the defaults), then
 * every argument of the call. A key of the result is the last of them that
 * writes it, at its whole path, as a deep merge answers it; an argument this
 * cannot see into (a parameter nothing hands a value) is taken to leave the
 * key out, and the read is marked as one through a merge, a guess.
 *
 * The merge is often kept where the bootstrap does not see it (P315): a
 * setter lays what it is handed over a module variable
 * (`current = mergeConfig(current, given)`) and a getter returns it
 * (`getConfig()`). A function of the repository's own that is no merge helper
 * answers what its `return`s do, a parameter being the argument of the call
 * stepped through; a module variable written by assignments holds each value
 * written, a setter's merge laying what each call of the setter made before
 * the read hands over the values written otherwise, the latest call on top.
 * A parameter read with no call stepped through is what each caller hands, or
 * its default where a caller hands nothing. Defaults loaded by a dynamic
 * import of a path decided at run time are not read, and the reader says so.
 */
const MERGES = /\.\.\.|\bObject\.(assign|entries|keys)\(|\bfor\s*\([^)]*\bin\b/;

/**
 * The function a callee names, where it is the repository's own and has a
 * body: a function, a constant holding one, and a method of a class or an
 * object (`settings.load(given)`, P321).
 */
const ownFunction = (callee: TsNode): TsNode | undefined => {
  const name = Node.isIdentifier(callee) ? callee : Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : undefined;
  if (name === undefined) return undefined;
  const symbol = name.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    const file = declaration.getSourceFile();
    if (file.isInNodeModules() || file.isDeclarationFile()) continue;
    if ((Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) && declaration.getBody() !== undefined) return declaration;
    if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) || Node.isPropertyDeclaration(declaration)) {
      const value = declaration.getInitializer();
      if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return value;
    }
  }
  return undefined;
};

/** Whether a function of the repository's own merges what it is handed, and calls itself or merges in its body. */
const isMergeHelper = (fn: TsNode): boolean => {
  if (parametersOf(fn).length === 0) return false;
  const body = Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) ? fn.getBody() : undefined;
  if (body === undefined) return false;
  if (MERGES.test(body.getText())) return true;
  const name = nameOfFunction(fn)?.getText();
  return name !== undefined && body.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => call.getExpression().getText() === name);
};

/** The object literals outside a function its body names: the defaults it lays what it is handed over. */
const defaultsNamed = (fn: TsNode): TsNode[] => {
  const found: TsNode[] = [];
  const seen = new Set<TsNode>();
  for (const name of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const symbol = name.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration) || seen.has(declaration)) continue;
      // A local of the helper is how it merges, not what.
      if (declaration.getSourceFile() === fn.getSourceFile() && declaration.getStart() >= fn.getStart() && declaration.getEnd() <= fn.getEnd()) continue;
      seen.add(declaration);
      const value = followed(declaration.getInitializer());
      if (value !== undefined && Node.isObjectLiteralExpression(value)) found.push(value);
    }
  }
  return found;
};

/** An expression through `await`, wrappers and the constants that hold it, to the call it is, if any. */
const callBehind = (node: TsNode | undefined, depth: number): CallExpression | undefined => {
  if (node === undefined || depth > DEPTH) return undefined;
  if (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return callBehind(node.getExpression(), depth + 1);
  }
  if (Node.isCallExpression(node)) return node;
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isVariableDeclaration(declaration) ? callBehind(declaration.getInitializer(), depth + 1) : undefined;
};

/** An expression under `await`, parentheses, `as`, `satisfies` and `!`. */
const unwrapped = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isAwaitExpression(at) ||
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isTypeAssertion(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** How deep, and in how many steps in all, a value is followed through calls, writes and callers (P315). */
const VALUE_DEPTH = 14;
const VALUE_STEPS = 400;

/** Where following a value has got to (P315). */
interface Walk {
  /** The calls stepped into on the way, the outermost first: where a value read inside them is read. */
  readonly via: readonly TsNode[];
  /** For each function stepped into, the call it was stepped into by: its parameters are that call's arguments. */
  readonly bound: ReadonlyMap<TsNode, Invocation>;
  /** Where what could not be read is said. */
  readonly sink: Trail;
  readonly steps: { left: number };
  /**
   * The holder a setter's object spreads over itself (`{ ...this.values,
   * ...given }`, P321): read there it is what lies beneath the setter's
   * layer, which the layers below answer, so it answers nothing itself.
   */
  readonly beneath?: TsNode;
}

/** The values an expression may hold at a path, and whether it may leave the path out or hold something not seen into. */
interface Values {
  readonly found: readonly Candidate[];
  readonly open: boolean;
}

const NOTHING: Values = { found: [], open: true };

const only = (value: TsNode): Values => ({ found: [{ value }], open: false });

const walkFrom = (trail?: Trail): Walk => ({ via: [], bound: new Map(), sink: trail ?? {}, steps: { left: VALUE_STEPS } });

/** Every value of some readings, open where any of them is, or where there is none. */
const union = (values: readonly Values[]): Values =>
  values.length === 0 ? NOTHING : { found: values.flatMap((each) => each.found), open: values.some((each) => each.open) };

/** Candidates marked as read through a merge, or handed in by a call, where they say neither already. */
const marked = (found: readonly Candidate[], how: { readonly mergedAt?: TsNode; readonly handedAt?: TsNode }): Candidate[] =>
  found.map((each) => {
    const mergedAt = each.mergedAt ?? how.mergedAt;
    const handedAt = each.handedAt ?? how.handedAt;
    return { value: each.value, ...(mergedAt === undefined ? {} : { mergedAt }), ...(handedAt === undefined ? {} : { handedAt }) };
  });

/** One object laid over the ones below it, the top first. */
interface Layer {
  readonly node: TsNode;
  readonly walk?: Walk;
  readonly mergedAt?: TsNode;
  readonly handedAt?: TsNode;
  /** It replaces everything below it rather than merging over it: a setter's plain write. */
  readonly replaces?: true;
}

/** What objects laid over each other answer at a path: each layer's value from the top, down to the first that surely writes it. */
const layered = (layers: readonly Layer[], keys: readonly string[], depth: number, walk: Walk): Values => {
  const found: Candidate[] = [];
  for (const layer of layers) {
    const read = valuesAt(layer.node, keys, depth + 1, layer.walk ?? walk);
    found.push(...marked(read.found, layer));
    if (!read.open || layer.replaces === true) return { found, open: false };
  }
  return { found, open: true };
};

/** Every value an expression may hold at a path (P305, P315): through objects, names, members, calls, parameters and module variables. */
const valuesAt = (expression: TsNode | undefined, keys: readonly string[], depth: number, walk: Walk): Values => {
  if (expression === undefined || depth > VALUE_DEPTH || walk.steps.left <= 0) return NOTHING;
  walk.steps.left -= 1;
  const node = unwrapped(expression);
  if (walk.beneath !== undefined && refersTo(node, walk.beneath)) return NOTHING;
  if (Node.isObjectLiteralExpression(node)) return keys.length === 0 ? only(node) : objectValuesAt(node, keys, depth, walk);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      const read = declaredValuesAt(declaration, node, keys, depth, walk);
      if (read !== undefined) return read;
    }
    return keys.length === 0 ? only(node) : NOTHING;
  }
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() !== 'process.env') {
    const declarations = node.getNameNode().getSymbol()?.getDeclarations() ?? [];
    // A property written after it is declared: each value written (P321).
    const holder = declarations.find((each) => holderOf(each) !== undefined);
    if (holder !== undefined) return holderValuesAt(holder, node, keys, depth, walk);
    // A key of a held literal written through a name typed otherwise, or one the literal does not declare (P329).
    const keyed = keyHolderAt(node);
    if (keyed !== undefined) {
      return keyed.property !== undefined ? holderValuesAt(keyed.property, node, keys, depth, walk) : keyValuesAt(keyed.literal, keyed.key, node, keys, depth, walk);
    }
    if (heldIn(node.getExpression()) === undefined) {
      for (const declaration of declarations) {
        const value = memberValue(declaration);
        if (value !== undefined) return valuesAt(value, keys, depth + 1, walk);
      }
    }
    const inner = valuesAt(node.getExpression(), [node.getName(), ...keys], depth + 1, walk);
    return inner.found.length === 0 && keys.length === 0 ? only(node) : inner;
  }
  if (Node.isCallExpression(node)) return callValuesAt(node, keys, depth, walk);
  return keys.length === 0 ? only(node) : NOTHING;
};

/** What a literal object writes at a path: the last property writing its first key, a spread included. */
const objectValuesAt = (node: TsNode, keys: readonly string[], depth: number, walk: Walk): Values => {
  if (!Node.isObjectLiteralExpression(node)) return NOTHING;
  const [key, ...rest] = keys as [string, ...string[]];
  for (const property of [...node.getProperties()].reverse()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = valuesAt(property.getExpression(), keys, depth + 1, walk);
      if (spread.found.length > 0) return spread;
      continue;
    }
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) continue;
    if (property.getName() !== key) continue;
    if (Node.isShorthandPropertyAssignment(property)) {
      // `{ port }`: the constant or the parameter of that name.
      const declaration = property.getValueSymbol()?.getDeclarations()[0];
      return (declaration === undefined ? undefined : declaredValuesAt(declaration, property.getNameNode(), rest, depth + 1, walk)) ?? NOTHING;
    }
    // A key written after the object is declared: what its writes say where it is read (P327).
    if (holderOf(property) !== undefined) return holderValuesAt(property, walk.sink.readAt ?? node, rest, depth + 1, walk);
    return valuesAt(property.getInitializer(), rest, depth + 1, walk);
  }
  return NOTHING;
};

/** What a name's declaration holds at a path, or nothing where it is no declaration this follows. */
const declaredValuesAt = (declaration: TsNode, at: TsNode, keys: readonly string[], depth: number, walk: Walk): Values | undefined => {
  if (Node.isParameterDeclaration(declaration)) {
    // A parameter written again in its function: the write before the read (P321).
    return holderOf(declaration) === undefined ? parameterValuesAt(declaration, keys, depth, walk) : localValuesAt(declaration, at, keys, depth, walk);
  }
  if (Node.isVariableDeclaration(declaration)) {
    if (holderOf(declaration) !== undefined) return holderValuesAt(declaration, at, keys, depth, walk);
    const initializer = declaration.getInitializer();
    return initializer === undefined ? undefined : valuesAt(initializer, keys, depth + 1, walk);
  }
  if (!Node.isBindingElement(declaration)) return undefined;
  const pattern = declaration.getParent();
  const owner = pattern.getParent();
  if (!Node.isObjectBindingPattern(pattern)) return undefined;
  const key = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
  const otherwise = declaration.getInitializer();
  // `{ port = 3000 }`: the default where the object it is taken from leaves the key out.
  const withDefault = (read: Values): Values => (otherwise === undefined || !read.open ? read : union([read, valuesAt(otherwise, keys, depth + 1, walk)]));
  if (Node.isVariableDeclaration(owner)) {
    const initializer = owner.getInitializer();
    return initializer === undefined ? undefined : withDefault(valuesAt(initializer, [key, ...keys], depth + 1, walk));
  }
  if (Node.isParameterDeclaration(owner)) return parameterValuesAt(owner, [key, ...keys], depth, walk, otherwise);
  return undefined;
};

/**
 * What a parameter holds at a path (P315): the argument of the call the
 * function was stepped into by, or else what each caller hands, one value per
 * caller, and its default where a caller hands nothing or nobody calls it.
 * `otherwise` is the default of the first key, `{ port = 3000 }`, for an
 * object that leaves it out.
 */
const parameterValuesAt = (parameter: TsNode, keys: readonly string[], depth: number, walk: Walk, otherwise?: TsNode): Values => {
  if (!Node.isParameterDeclaration(parameter)) return NOTHING;
  const fn = parameter.getParent();
  const index = parametersOf(fn).indexOf(parameter);
  const keyDefault = (read: Values): Values =>
    otherwise === undefined || !read.open ? read : union([read, valuesAt(otherwise, keys.slice(1), depth + 1, walk)]);
  const own = parameter.getInitializer();
  const leftOut = (): Values => keyDefault(own === undefined ? NOTHING : valuesAt(own, keys, depth + 1, walk));
  const handedBy = (call: Invocation): Values => {
    const argument = index < 0 ? undefined : call.getArguments()[index];
    if (argument === undefined) return leftOut();
    const handed = valuesAt(argument, keys, depth + 1, walk);
    return keyDefault({ found: marked(handed.found, { handedAt: call }), open: handed.open });
  };
  const bound = walk.bound.get(fn);
  if (bound !== undefined) return handedBy(bound);
  const calls = index < 0 ? [] : callsOf(fn);
  return calls.length === 0 ? leftOut() : union(calls.map(handedBy));
};

/** Whether a node is a function of its own, the scope its parameters and `return`s belong to. */
const isFunctionLike = (node: TsNode): boolean =>
  Node.isFunctionDeclaration(node) ||
  Node.isFunctionExpression(node) ||
  Node.isArrowFunction(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isConstructorDeclaration(node) ||
  Node.isGetAccessorDeclaration(node) ||
  Node.isSetAccessorDeclaration(node);

/** The function a node is in, or its file where it is in none. */
const scopeOf = (node: TsNode): TsNode => node.getFirstAncestor(isFunctionLike) ?? node.getSourceFile();

/** What a function's `return`s answer: an arrow's expression body, or every `return` of its own. */
const returnsOf = (fn: TsNode): TsNode[] => {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!Node.isBlock(body)) return [body];
  }
  const body = Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn) || Node.isMethodDeclaration(fn) ? fn.getBody() : undefined;
  if (body === undefined) return [];
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement).flatMap((each) => {
    const value = each.getExpression();
    return value !== undefined && scopeOf(each) === fn ? [value] : [];
  });
};

/** Whether a call loads a module by a path: `import(path)`, `require(path)`. */
const loadsModule = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  return callee.getKind() === SyntaxKind.ImportKeyword || (Node.isIdentifier(callee) && callee.getText() === 'require');
};

/** The extensions a module path is tried with where it is written without its source's, the source's first. */
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The file of the project a module path names, tried as written, with each extension and as a directory's index. */
const moduleFileAt = (project: ReturnType<TsNode['getProject']>, path: string): SourceFile | undefined => {
  const bare = path.replace(/\.[cm]?[jt]sx?$/, '');
  const candidates = [path, ...MODULE_EXTENSIONS.map((extension) => `${bare}${extension}`), ...MODULE_EXTENSIONS.map((extension) => join(bare, `index${extension}`))];
  for (const candidate of candidates) {
    const file = project.getSourceFile(candidate);
    if (file !== undefined && !file.isDeclarationFile() && !file.isInNodeModules()) return file;
  }
  return undefined;
};

/**
 * The file of the repository a call loads (P321): a path written relative to
 * the file that loads it (`import('./defaults')`), or one built from that
 * file's own directory - `require(path.join(__dirname, 'defaults'))`,
 * `import(path.resolve(__dirname, '../config'))`, through the constant that
 * holds it - read as a configuration's {@link ConfigPath} is. `computed` says
 * the path is not written as a string; `file` is absent where the path is a
 * package's, is built from something else, or names no file of the project.
 */
const moduleLoaded = (call: CallExpression): { readonly file?: SourceFile; readonly computed: boolean } => {
  const argument = call.getArguments()[0];
  if (argument === undefined) return { computed: false };
  const literal = literalText(argument);
  const relativeTo = (node: TsNode, text: string): string | undefined =>
    text.startsWith('.') ? resolve(dirname(node.getSourceFile().getFilePath()), text) : undefined;
  if (literal !== undefined) {
    const path = relativeTo(argument, literal);
    const file = path === undefined ? undefined : moduleFileAt(call.getProject(), path);
    return file === undefined ? { computed: false } : { file, computed: false };
  }
  const written = followed(argument);
  let path: string | undefined;
  if (written !== undefined) {
    const text = literalText(written);
    const source = written.getSourceFile();
    path =
      text !== undefined
        ? relativeTo(written, text)
        : ownDirectoryPath(written.compilerNode as ts.Expression, source.compilerNode, dirname(source.getFilePath()));
  }
  const file = path === undefined ? undefined : moduleFileAt(call.getProject(), path);
  return file === undefined ? { computed: true } : { file, computed: true };
};

/** What `module.exports = value` makes a module's whole export, where the module writes it. */
const commonExportsOf = (file: SourceFile): TsNode | undefined => {
  for (const statement of file.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (Node.isBinaryExpression(expression) && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken && expression.getLeft().getText() === 'module.exports') {
      return expression.getRight();
    }
  }
  return undefined;
};

/**
 * What a module a call loads answers at a path (P321): `require()` answers
 * the module's `module.exports`, or its exports by name where it writes none;
 * `import()` its exports by name, `default` the default one. The module itself
 * is no value a port is read from.
 */
const moduleValuesAt = (file: SourceFile, keys: readonly string[], required: boolean, depth: number, walk: Walk): Values => {
  if (keys.length === 0) return NOTHING;
  const whole = commonExportsOf(file);
  if (whole !== undefined) {
    if (required) return valuesAt(whole, keys, depth + 1, walk);
    return keys[0] === 'default' ? valuesAt(whole, keys.slice(1), depth + 1, walk) : NOTHING;
  }
  const [name, ...rest] = keys as [string, ...string[]];
  for (const declaration of file.getExportedDeclarations().get(name) ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      if (value !== undefined) return valuesAt(value, rest, depth + 1, walk);
    } else if (Node.isExpression(declaration)) {
      return valuesAt(declaration, rest, depth + 1, walk);
    }
  }
  return NOTHING;
};

/**
 * What a call answers at a path: what a merge helper of the repository's own
 * lays over its defaults (P305), else what the function's `return`s answer,
 * its parameters being this call's arguments (P315). A module loaded by a
 * path relative to its file, or built from its own directory, answers what it
 * exports (P321); one loaded by a path decided otherwise at run time, or
 * naming no file of the repository, answers nothing this reads, and says so.
 */
const callValuesAt = (call: CallExpression, keys: readonly string[], depth: number, walk: Walk): Values => {
  if (loadsModule(call)) {
    const loaded = moduleLoaded(call);
    if (loaded.file !== undefined) return moduleValuesAt(loaded.file, keys, Node.isIdentifier(call.getExpression()), depth, walk);
    if (loaded.computed) walk.sink.unreadAt ??= call;
    return NOTHING;
  }
  const fn = ownFunction(call.getExpression());
  if (fn === undefined) return keys.length === 0 ? only(call) : NOTHING;
  if (keys.length > 0 && isMergeHelper(fn)) {
    const layers = [...defaultsNamed(fn), ...call.getArguments()].reverse().map((node) => ({ node, mergedAt: call }));
    const merged = layered(layers, keys, depth, walk);
    if (merged.found.length > 0) return merged;
  }
  const inner: Walk = { ...walk, via: [...walk.via, call], bound: new Map([...walk.bound, [fn, call]]) };
  return union(returnsOf(fn).map((returned) => valuesAt(returned, keys, depth + 1, inner)));
};

/** A name as a regular expression matches it. */
const escaped = (name: string): string => name.replace(/[$]/g, '\\$');

const isAssignment = (each: BinaryExpression): boolean => each.getOperatorToken().getKind() === SyntaxKind.EqualsToken;

/**
 * A property that may be written after it is declared (P321): a field of a
 * class that is not `readonly`, or a key of the object a variable is given
 * (`const state = { config: defaults }`).
 */
const heldProperty = (declaration: TsNode): boolean => {
  if (Node.isPropertyDeclaration(declaration)) return !declaration.isReadonly();
  if (!Node.isPropertyAssignment(declaration)) return false;
  // A key of an object inside such an object too, `{ server: { port } }` (P327).
  let object: TsNode | undefined = declaration.getParent();
  for (let depth = 0; depth < DEPTH && object !== undefined && Node.isObjectLiteralExpression(object); depth++) {
    const owner = object.getParent();
    if (owner !== undefined && Node.isVariableDeclaration(owner)) return true;
    if (owner === undefined || !Node.isPropertyAssignment(owner)) return false;
    object = owner.getParent();
  }
  return false;
};

/**
 * One key an `Object.assign(target, ...sources)` lays over an object holding
 * a property (P327): the source the key is read from (`value` at `under`),
 * and where it is written - the call, or the call handing the object to a
 * function that assigns into its parameter (P329), whose arguments are then
 * what that function's parameters are (`bound`).
 */
interface Assigned {
  readonly call: TsNode;
  readonly value: TsNode;
  readonly under: readonly string[];
  readonly bound?: Handing;
}

/** A call a function was reached by, its parameters being the call's arguments (P329). */
interface Handing {
  readonly fn: TsNode;
  readonly call: Invocation;
}

/** The `Object.assign` calls of a project's files, outside tests, cached per project. */
const assignCallsCache = new WeakMap<object, readonly CallExpression[]>();

const assignCallsOf = (file: SourceFile): readonly CallExpression[] => {
  const project = file.getProject();
  const cached = assignCallsCache.get(project);
  if (cached !== undefined) return cached;
  const found = project
    .getSourceFiles()
    .filter((each) => !each.isInNodeModules() && !each.isDeclarationFile() && !isTestName(each.getBaseName()) && each.getFullText().includes('Object.assign('))
    .flatMap((each) => each.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getText() === 'Object.assign' && call.getArguments().length >= 2));
  assignCallsCache.set(project, found);
  return found;
};

/** The fields of the class `this` is in, where a target is `this` (P327). */
const fieldsOfThis = (target: TsNode): readonly TsNode[] => {
  const node = unwrapped(target);
  if (!Node.isThisExpression(node)) return [];
  const owner = node.getFirstAncestor((each) => Node.isClassDeclaration(each) || Node.isClassExpression(each));
  return owner !== undefined && (Node.isClassDeclaration(owner) || Node.isClassExpression(owner)) ? owner.getProperties().filter((each) => !each.isStatic()) : [];
};

/** One object literal an expression names, and the call it was handed in by where it is reached through a parameter (P329). */
interface NamedLiteral {
  readonly literal: TsNode;
  readonly handed?: Handing;
  /**
   * Every call it was handed in by, the function the expression is in first
   * and the call nearest the literal last (P335): `apply(target)` reached by
   * `boot(config) { apply(config); }` is `apply(config)`, then `boot(...)`.
   */
  readonly chain?: readonly Handing[];
}

/** The object literal a value is, under its wrappers. */
const literalIn = (value: TsNode | undefined): TsNode | undefined => {
  const object = value === undefined ? undefined : unwrapped(value);
  return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
};

/**
 * The object literals an expression may name (P327, P329): the literal a
 * variable holds unchanged (`config`), a key's literal inside it
 * (`config.server`), what a function of the repository's own returns
 * (`getConfig()`, a getter of a held configuration), and what each caller
 * hands a parameter (`apply(config, overrides)` of `Object.assign(target,
 * overrides)`), with the call that handed it.
 */
const namedCache = new WeakMap<TsNode, NamedLiteral[]>();

const literalsNamed = (expression: TsNode, depth = 0, throughParameters = true): NamedLiteral[] => {
  if (depth > DEPTH) return [];
  if (depth === 0 && throughParameters) {
    const cached = namedCache.get(expression);
    if (cached !== undefined) return cached;
    namedCache.set(expression, []);
    const found = literalsNamed(expression, 1, true);
    namedCache.set(expression, found);
    return found;
  }
  const node = unwrapped(expression);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
    if (declaration === undefined || holderOf(declaration) !== undefined) return [];
    if (Node.isVariableDeclaration(declaration)) {
      const literal = literalIn(declaration.getInitializer());
      return literal === undefined ? [] : [{ literal }];
    }
    if (!throughParameters || !Node.isParameterDeclaration(declaration)) return [];
    const fn = declaration.getParent();
    const index = parametersOf(fn).indexOf(declaration);
    if (index < 0) return [];
    return callsOf(fn).flatMap((call) => {
      const argument = call.getArguments()[index];
      return argument === undefined
        ? []
        : literalsNamed(argument, depth + 1).map((each) => ({ literal: each.literal, handed: each.handed ?? { fn, call }, chain: [{ fn, call }, ...(each.chain ?? [])] }));
    });
  }
  if (Node.isPropertyAccessExpression(node)) {
    return literalsNamed(node.getExpression(), depth + 1, throughParameters).flatMap((owner) => {
      const property = Node.isObjectLiteralExpression(owner.literal) ? owner.literal.getProperty(node.getName()) : undefined;
      const literal = property !== undefined && Node.isPropertyAssignment(property) ? literalIn(property.getInitializer()) : undefined;
      return literal === undefined ? [] : [{ ...owner, literal }];
    });
  }
  if (Node.isCallExpression(node) && !loadsModule(node)) {
    const fn = ownFunction(node.getExpression());
    return fn === undefined ? [] : returnsOf(fn).flatMap((returned) => literalsNamed(returned, depth + 1, throughParameters));
  }
  return [];
};

/** Whether a source of `Object.assign` surely leaves a key out: a literal object that neither writes nor spreads it. */
const leavesOut = (source: TsNode, key: string): boolean => {
  const node = unwrapped(source);
  return Node.isObjectLiteralExpression(node) && node.getProperty(key) === undefined && !node.getProperties().some((each) => Node.isSpreadAssignment(each));
};

/**
 * The keys `Object.assign` calls lay over an object, the last source of a call
 * first (P327): `owns` says, for a call's target, each time it is the object
 * and the call it was handed in by, if any.
 */
const assignsInto = (file: SourceFile, key: string, owns: (target: TsNode) => readonly (Handing | undefined)[]): Assigned[] =>
  assignCallsOf(file).flatMap((call) => {
    const [target, ...sources] = call.getArguments();
    if (target === undefined) return [];
    return owns(target).flatMap((handed) =>
      [...sources].reverse().flatMap((value) => (leavesOut(value, key) ? [] : [{ call: handed?.call ?? call, value, under: [key], ...(handed === undefined ? {} : { bound: handed }) }])),
    );
  });

/** Each time a target names a literal, and the call it was handed in by (P329). */
const ownedBy =
  (literal: TsNode) =>
  (target: TsNode): readonly (Handing | undefined)[] =>
    literalsNamed(target)
      .filter((each) => each.literal === literal)
      .map((each) => each.handed);

/** The keys `Object.assign` calls lay over a property's object, the last source of a call first (P327). */
const assignedCache = new WeakMap<TsNode, readonly Assigned[]>();

const assignedOf = (declaration: TsNode): readonly Assigned[] => {
  const cached = assignedCache.get(declaration);
  if (cached !== undefined) return cached;
  let found: Assigned[] = [];
  if (Node.isPropertyDeclaration(declaration) && heldProperty(declaration)) {
    found = assignsInto(declaration.getSourceFile(), declaration.getName(), (target) => (fieldsOfThis(target).includes(declaration) ? [undefined] : []));
  } else if (Node.isPropertyAssignment(declaration) && heldProperty(declaration)) {
    found = assignsInto(declaration.getSourceFile(), declaration.getName(), ownedBy(declaration.getParent()));
  }
  assignedCache.set(declaration, found);
  return found;
};

/**
 * The writes of a key of an object literal a variable holds, made through any
 * expression naming that literal (P329): `config.port = 4000` where `const
 * config: Config = { port: 3000 }` types the key, so that its name resolves to
 * the type's member rather than to the literal's, and a key the literal does
 * not declare at all (`const config: Config = {}; config.port = 4000`) - each
 * place the object is named, the variable, a getter returning it, a parameter
 * handed it.
 */
const keyWritesCache = new WeakMap<TsNode, Map<string, readonly BinaryExpression[]>>();

const keyWritesOf = (literal: TsNode, key: string): readonly BinaryExpression[] => {
  let byKey = keyWritesCache.get(literal);
  if (byKey === undefined) {
    byKey = new Map();
    keyWritesCache.set(literal, byKey);
  }
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  byKey.set(key, []);
  let found: BinaryExpression[] = [];
  if (/^[A-Za-z_$][\w$]*$/.test(key)) {
    const pattern = new RegExp(`\\.${escaped(key)}\\s*=[^=]`);
    found = literal
      .getProject()
      .getSourceFiles()
      .filter((each) => !each.isInNodeModules() && !each.isDeclarationFile() && !isTestName(each.getBaseName()) && pattern.test(each.getFullText()))
      .flatMap((each) =>
        each.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((write) => {
          const left = write.getLeft();
          return isAssignment(write) && Node.isPropertyAccessExpression(left) && left.getName() === key && literalsNamed(left.getExpression()).some((named) => named.literal === literal);
        }),
      );
  }
  byKey.set(key, found);
  return found;
};

/**
 * Where an access reads a key of an object literal a variable holds, which
 * code writes after it (P329), though the key's name does not resolve to the
 * literal's own property: that property where the literal declares it, else
 * the literal and the key it does not declare.
 */
const keyHolderAt = (access: TsNode): { readonly property?: TsNode; readonly literal: TsNode; readonly key: string } | undefined => {
  if (!Node.isPropertyAccessExpression(access) || access.getExpression().getText() === 'process.env') return undefined;
  const key = access.getName();
  for (const { literal } of literalsNamed(access.getExpression(), 1, false)) {
    if (!Node.isObjectLiteralExpression(literal)) continue;
    const property = literal.getProperty(key);
    if (property !== undefined) {
      if (Node.isPropertyAssignment(property) && holderOf(property) !== undefined) return { property, literal, key };
      continue;
    }
    if (keyWritesOf(literal, key).length > 0 || assignsInto(literal.getSourceFile(), key, ownedBy(literal)).length > 0) return { literal, key };
  }
  return undefined;
};

/**
 * The assignments of a variable or a parameter in its file, `name = value`
 * (P315), and those of a property anywhere it is written - in its class's
 * file where it is private - `<object>.name = value`, `this.name = value`
 * (P321). A test's writes are the test's.
 */
const writesCache = new WeakMap<TsNode, readonly BinaryExpression[]>();

const writesOf = (declaration: TsNode): readonly BinaryExpression[] => {
  const cached = writesCache.get(declaration);
  if (cached !== undefined) return cached;
  let found: BinaryExpression[] = [];
  if ((Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration)) && Node.isIdentifier(declaration.getNameNode())) {
    const name = declaration.getName();
    const symbol = declaration.getSymbol()?.compilerSymbol;
    const file = declaration.getSourceFile();
    if (symbol !== undefined && new RegExp(`(?:^|[^.\\w$])${escaped(name)}\\s*=[^=]`).test(file.getFullText())) {
      found = file.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((each) => {
        const left = each.getLeft();
        return isAssignment(each) && Node.isIdentifier(left) && left.getText() === name && left.getSymbol()?.compilerSymbol === symbol;
      });
    }
  } else if ((Node.isPropertyDeclaration(declaration) || Node.isPropertyAssignment(declaration)) && heldProperty(declaration)) {
    const name = declaration.getName();
    if (/^#?[A-Za-z_$][\w$]*$/.test(name)) {
      const pattern = new RegExp(`\\.${escaped(name)}\\s*=[^=]`);
      const own = declaration.getSourceFile();
      const kept = Node.isPropertyDeclaration(declaration) && (name.startsWith('#') || declaration.hasModifier(SyntaxKind.PrivateKeyword));
      const files = kept ? [own] : own.getProject().getSourceFiles().filter((each) => !each.isInNodeModules() && !each.isDeclarationFile() && !isTestName(each.getBaseName()));
      found = files
        .filter((each) => pattern.test(each.getFullText()))
        .flatMap((each) =>
          each.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((write) => {
            const left = write.getLeft();
            return (
              isAssignment(write) &&
              Node.isPropertyAccessExpression(left) &&
              left.getName() === name &&
              (left.getNameNode().getSymbol()?.getDeclarations() ?? []).includes(declaration)
            );
          }),
        );
      // A key of a literal written through a name typed otherwise, its name the type's member (P329).
      if (Node.isPropertyAssignment(declaration)) {
        const typed = keyWritesOf(declaration.getParent(), name).filter((write) => !found.includes(write));
        found = [...found, ...typed];
      }
    }
  }
  writesCache.set(declaration, found);
  return found;
};

/**
 * How a declaration written by assignments holds its value (P315, P321): a
 * variable at the top of a module (`module`) or a property (`property`) holds
 * each value written, a setter's laid over the others once per call; a
 * variable of a function or a parameter (`local`) holds the one written last
 * before it is read.
 */
type HolderKind = 'module' | 'local' | 'property';

const kindCache = new WeakMap<TsNode, HolderKind | 'none'>();

const holderKindOf = (declaration: TsNode): HolderKind | undefined => {
  const cached = kindCache.get(declaration);
  if (cached !== undefined) return cached === 'none' ? undefined : cached;
  let kind: HolderKind | undefined;
  if (Node.isVariableDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
    const statement = declaration.getVariableStatement();
    if (statement !== undefined && statement.getDeclarationKind() !== VariableDeclarationKind.Const && writesOf(declaration).length > 0) {
      kind = Node.isSourceFile(statement.getParent()) ? 'module' : 'local';
    }
  } else if (Node.isParameterDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
    if (writesOf(declaration).length > 0) kind = 'local';
  } else if (heldProperty(declaration) && (writesOf(declaration).length > 0 || assignedOf(declaration).length > 0)) {
    kind = 'property';
  }
  kindCache.set(declaration, kind ?? 'none');
  return kind;
};

/** A declaration assignments write after it: a holder a setter fills and a getter returns (P315), a property, a variable of a function written again (P321). */
const holderOf = (declaration: TsNode): TsNode | undefined => (holderKindOf(declaration) === undefined ? undefined : declaration);

/** Whether an expression reads a declaration: a name of it, or a property access of it (`this.config`). */
const refersTo = (node: TsNode, declaration: TsNode): boolean => {
  const value = unwrapped(node);
  const name = Node.isIdentifier(value) ? value : Node.isPropertyAccessExpression(value) ? value.getNameNode() : undefined;
  const symbol = name?.getSymbol();
  return ((symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []).includes(declaration);
};

/**
 * Whether a value written is read (P321): something is found in it, or it is
 * an object that leaves the key out; and, read whole, it is no call of a
 * function that is not the repository's own, which answers what nothing here
 * says (`await findFreePort(port)`).
 */
const readable = (value: TsNode, read: Values, keys: readonly string[]): boolean => {
  const node = unwrapped(value);
  if (read.found.length === 0) return keys.length > 0 && Node.isObjectLiteralExpression(node);
  if (keys.length > 0 || !Node.isCallExpression(node)) return true;
  return loadsModule(node) || ownFunction(node.getExpression()) !== undefined || /^(?:Number|parseInt|parseFloat|String)$/.test(node.getExpression().getText());
};

/** The statement an expression is the whole of, through `await`, `void` and parentheses: `await apply(config);` of `apply(config)` (P335). */
const statementOf = (node: TsNode): TsNode | undefined => {
  let parent = node.getParent();
  while (parent !== undefined && (Node.isAwaitExpression(parent) || Node.isVoidExpression(parent) || Node.isParenthesizedExpression(parent))) parent = parent.getParent();
  return parent;
};

/** Whether a write is a statement of a block the read is in, and so is made on every way to the read after it (P321). */
const surelyBefore = (write: TsNode, at: TsNode): boolean => {
  const statement = statementOf(write);
  const block = statement?.getParent();
  return (
    statement !== undefined &&
    Node.isExpressionStatement(statement) &&
    block !== undefined &&
    (Node.isBlock(block) || Node.isSourceFile(block)) &&
    block.getStart() <= at.getStart() &&
    at.getEnd() <= block.getEnd()
  );
};

/** Whether a node is a statement of a function's own body, made every time the function runs (P335). */
const surelyMadeIn = (node: TsNode, fn: TsNode): boolean => {
  const statement = statementOf(node);
  const body = Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn) || Node.isMethodDeclaration(fn) || Node.isConstructorDeclaration(fn) ? fn.getBody() : undefined;
  return statement !== undefined && Node.isExpressionStatement(statement) && body !== undefined && statement.getParent() === body;
};

/** Whether a write, or a call that makes one, is made in the read's own block before it (P327, P335). */
const madeBeforeIn = (write: TsNode, at: TsNode): boolean =>
  write.getSourceFile() === at.getSourceFile() && write.getEnd() <= at.getStart() && scopeOf(write) === scopeOf(at) && surelyBefore(write, at);

/**
 * Where a write of a key made through a parameter stands for a read (P335):
 * `function apply(target) { target.port = 4000; }` and `apply(config);`
 * before `app.listen(config.port)`. Where the write is a statement of its
 * function's body, and each call handing the object in down to one made in
 * the read's own block before it is one of its function's in turn, that call
 * is where the write is made - the last write before the read, cutting the
 * values before it as a write written there would - its function's parameters
 * that call's arguments. Otherwise the write is a value the key may hold, as
 * before.
 */
const placedWrites = (write: BinaryExpression, literal: TsNode, at: TsNode): Written[] => {
  const left = write.getLeft();
  const chains = Node.isPropertyAccessExpression(left)
    ? literalsNamed(left.getExpression()).flatMap((named) => (named.literal === literal && named.chain !== undefined && named.chain.length > 0 ? [named.chain] : []))
    : [];
  const placed: Written[] = [];
  for (const chain of chains) {
    let made: TsNode = write;
    for (const step of chain) {
      if (!surelyMadeIn(made, step.fn)) break;
      if (madeBeforeIn(step.call, at)) {
        placed.push({ value: write.getRight(), write: step.call, bound: chain[0] as Handing });
        break;
      }
      made = step.call;
    }
  }
  return placed.length > 0 ? placed : [{ value: write.getRight(), write }];
};

/**
 * What a variable of a function, or a parameter, written again in it holds
 * at a path where it is read (P321): `let config = getConfig(); config =
 * await applyPlugins(config);`. The writes before the read are its values,
 * the last first, down to the last one that is surely made on the way to the
 * read (a statement of a block the read is in); its first value - the
 * initializer, or what the parameter is handed - where no write surely is. A
 * write whose value is not read is said (`rewrittenAt`), and the values from
 * before it are read as well, as a guess.
 */
const localValuesAt = (declaration: TsNode, at: TsNode, keys: readonly string[], depth: number, walk: Walk): Values => {
  const own = scopeOf(declaration);
  const file = at.getSourceFile();
  const before = writesOf(declaration)
    .filter((write) => write.getSourceFile() === file && write.getEnd() <= at.getStart())
    .sort((a, b) => b.getStart() - a.getStart());
  const found: Candidate[] = [];
  for (const write of before) {
    const read = valuesAt(write.getRight(), keys, depth + 1, walk);
    const clear = readable(write.getRight(), read, keys);
    if (!clear) walk.sink.rewrittenAt ??= write;
    found.push(...read.found);
    if (clear && scopeOf(write) === own && surelyBefore(write, at)) return { found, open: read.open };
  }
  const first = Node.isParameterDeclaration(declaration)
    ? parameterValuesAt(declaration, keys, depth, walk)
    : valuesAt(Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined, keys, depth + 1, walk);
  return { found: [...found, ...first.found], open: first.open };
};

/** Whether an expression names a parameter of a function. */
const namesParameterOf = (value: TsNode, fn: TsNode): boolean => {
  const node = unwrapped(value);
  if (!Node.isIdentifier(node)) return false;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isParameterDeclaration(declaration) && declaration.getParent() === fn;
};

/**
 * The function a write is made for (P321): the one it is in, or - where that
 * is an unnamed callback (`ready.then(() => { active = given; })`) - the named
 * function the callback is written in, whose calls are what make the write.
 */
const setterScopeOf = (write: TsNode): TsNode => {
  let scope = scopeOf(write);
  while ((Node.isArrowFunction(scope) || Node.isFunctionExpression(scope)) && nameOfFunction(scope) === undefined) scope = scopeOf(scope);
  return scope;
};

/**
 * Whether a call is made before a value is read (P315): in the function, or
 * the file, one of the places it is read is in - the read itself, then each
 * call stepped through to reach it - and earlier in it; or before a call of
 * the function the outermost of them is in, through up to three callers. The
 * bootstrap that calls `setConfig(given)` and then `getConfig()`, or calls the
 * setter and then the function that reads, is the order this asks about.
 */
const precedes = (call: TsNode, points: readonly TsNode[]): boolean => {
  const scope = scopeOf(call);
  const before = (point: TsNode): boolean => scopeOf(point) === scope && call.getStart() < point.getStart();
  if (points.some(before)) return true;
  let frontier = points.slice(-1);
  for (let depth = 0; depth < HANDED_DEPTH && frontier.length > 0; depth++) {
    const next: TsNode[] = [];
    for (const point of frontier) {
      const outer = scopeOf(point);
      if (Node.isSourceFile(outer)) continue;
      for (const caller of callsOf(outer)) {
        if (before(caller)) return true;
        next.push(caller);
      }
    }
    frontier = next;
  }
  return false;
};

/** The order calls are made in, as far as their places say: by file, then by position. */
const byPlace = (a: TsNode, b: TsNode): number => {
  const fileA = a.getSourceFile().getFilePath();
  const fileB = b.getSourceFile().getFilePath();
  return fileA < fileB ? -1 : fileA > fileB ? 1 : a.getStart() - b.getStart();
};

/** A setter's write of a module variable, laid over the values written otherwise once per call of the setter (P315). */
interface SetterWrite {
  /** The function that writes, or the file where the write is at its top level. */
  readonly scope: TsNode;
  /** What it lays over the variable, the bottom first. */
  readonly layers: readonly TsNode[];
  readonly mergedAt?: TsNode;
  readonly replaces?: true;
  /** It is an object spreading the holder itself under what it writes: read with the holder answering nothing (P321). */
  readonly spreads?: true;
}

/** The function `this` is the receiver of in a node: the nearest one that is not an arrow, which keeps the `this` around it. */
const thisScopeOf = (node: TsNode): TsNode | undefined => {
  let scope = node.getFirstAncestor(isFunctionLike);
  while (scope !== undefined && Node.isArrowFunction(scope)) scope = scope.getFirstAncestor(isFunctionLike);
  return scope;
};

/**
 * The instance of a class an expression is, where it is told (P327, P329): a
 * `new` written there or held by a constant (`const one = new Settings()`,
 * the constant standing for it), or `this` in a method stepped into by a call
 * on such an instance, or in a constructor stepped into by its `new`; a
 * parameter, the instance the call the function was stepped into by hands
 * it, or the one every caller hands it where they all hand the same; a field
 * or a parameter property (`this.server`, `constructor(private server:
 * Server)`), the one instance every value it is given is.
 */
const instanceOf = (receiver: TsNode, walk: Walk, depth = 0): TsNode | undefined => {
  if (depth > DEPTH) return undefined;
  const node = unwrapped(receiver);
  if (Node.isNewExpression(node)) {
    const parent = node.getParent();
    return parent !== undefined && Node.isVariableDeclaration(parent) ? parent : node;
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isParameterDeclaration(declaration)) return handedInstance(declaration, walk, depth);
    if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
    const value = declaration.getInitializer();
    return value !== undefined && Node.isNewExpression(unwrapped(value)) ? declaration : undefined;
  }
  // `this.server`: the instance a field, or a parameter property, holds (P329).
  if (Node.isPropertyAccessExpression(node)) {
    const field = node.getNameNode().getSymbol()?.getDeclarations()[0];
    if (field === undefined) return undefined;
    if (Node.isParameterDeclaration(field)) return handedInstance(field, walk, depth);
    if (!Node.isPropertyDeclaration(field)) return undefined;
    const initializer = field.getInitializer();
    const values = [...(initializer === undefined ? [] : [initializer]), ...writesOf(field).map((write) => write.getRight())];
    return sameInstance(values.map((value) => instanceOf(value, walk, depth + 1)));
  }
  if (!Node.isThisExpression(node)) return undefined;
  const method = thisScopeOf(node);
  const bound = method === undefined ? undefined : walk.bound.get(method);
  if (bound === undefined) return undefined;
  if (Node.isNewExpression(bound)) return instanceOf(bound, walk, depth + 1);
  const callee = bound.getExpression();
  return Node.isPropertyAccessExpression(callee) ? instanceOf(callee.getExpression(), walk, depth + 1) : undefined;
};

/** The one instance some are, or nothing where any is not told or two differ (P329). */
const sameInstance = (instances: readonly (TsNode | undefined)[]): TsNode | undefined => {
  const [first] = instances;
  return first !== undefined && instances.every((each) => each === first) ? first : undefined;
};

/**
 * The instance a parameter is handed (P329): the argument of the call its
 * function was stepped into by, or the one instance every caller hands.
 */
const handedInstance = (parameter: TsNode, walk: Walk, depth: number): TsNode | undefined => {
  if (!Node.isParameterDeclaration(parameter) || holderOf(parameter) !== undefined) return undefined;
  const fn = parameter.getParent();
  const index = parametersOf(fn).indexOf(parameter);
  if (index < 0) return undefined;
  const handedBy = (call: Invocation): TsNode | undefined => {
    const argument = call.getArguments()[index];
    return argument === undefined ? undefined : instanceOf(argument, walk, depth + 1);
  };
  const bound = walk.bound.get(fn);
  if (bound !== undefined) return handedBy(bound);
  return sameInstance(callsOf(fn).map(handedBy));
};

/** How many functions out a receiver handed through parameters is followed to the instances its callers hand (P335). */
const TOLD_LEVELS = 8;

/** How many calls, all levels together, that walk steps through before it gives up (P335). */
const TOLD_STEPS = 256;

/**
 * The ways a receiver is told an instance (P329, P335): as it is, or - where
 * it is a parameter its callers hand different instances - once per caller,
 * the function stepped into by that caller; and where a caller hands it a
 * parameter of its own (`launch(server) { boot(server); }`), once per caller
 * of that function in turn, out to eight functions and 256 calls. Nothing
 * where any caller's instance is not told.
 */
const toldWalks = (receiver: TsNode, walk: Walk, level = 0, steps: { left: number } = { left: TOLD_STEPS }): Walk[] | undefined => {
  if (instanceOf(receiver, walk) !== undefined) return [walk];
  if (level >= TOLD_LEVELS) return undefined;
  const node = unwrapped(receiver);
  const declaration = Node.isIdentifier(node) ? node.getSymbol()?.getDeclarations()[0] : undefined;
  if (declaration === undefined || !Node.isParameterDeclaration(declaration)) return undefined;
  const fn = declaration.getParent();
  if (walk.bound.has(fn)) return undefined;
  const index = parametersOf(fn).indexOf(declaration);
  const calls = callsOf(fn);
  if (calls.length === 0 || index < 0) return undefined;
  const walks: Walk[] = [];
  for (const call of calls) {
    steps.left -= 1;
    if (steps.left < 0) return undefined;
    const bound: Walk = { ...walk, bound: new Map([...walk.bound, [fn, call]]) };
    if (instanceOf(receiver, bound) !== undefined) {
      walks.push(bound);
      continue;
    }
    // The caller hands a parameter of its own: told once per caller of its function.
    const argument = call.getArguments()[index];
    const outer = argument === undefined ? undefined : toldWalks(argument, bound, level + 1, steps);
    if (outer === undefined) return undefined;
    walks.push(...outer);
  }
  return walks;
};

/** The `new` an instance was made by. */
const newOf = (instance: TsNode): NewExpression | undefined => {
  const made = Node.isVariableDeclaration(instance) ? instance.getInitializer() : instance;
  const node = made === undefined ? undefined : unwrapped(made);
  return node !== undefined && Node.isNewExpression(node) ? node : undefined;
};

/** The receiver a call is made on: `one` of `one.load(given)`. */
const receiverOf = (call: Invocation): TsNode | undefined => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
};

/** Whether a declaration is a field each instance of its class holds its own of. */
const isInstanceField = (declaration: TsNode): boolean => Node.isPropertyDeclaration(declaration) && !declaration.isStatic();

/**
 * A field read through `this` in a method no call was stepped through to
 * reach (P327): read once per call of the method, each on the instance it is
 * made on - `first.start()` reads the field `first` was made with - where
 * every call's instance is told; otherwise nothing, and the field is read
 * for every instance at once.
 */
const perCallOfMethod = (declaration: TsNode, at: TsNode, keys: readonly string[], depth: number, walk: Walk): Values | undefined => {
  if (!isInstanceField(declaration) || !Node.isPropertyAccessExpression(at) || !Node.isThisExpression(unwrapped(at.getExpression()))) return undefined;
  const method = thisScopeOf(at);
  if (method === undefined || Node.isConstructorDeclaration(method) || walk.bound.has(method)) return undefined;
  const calls = callsOf(method);
  if (calls.length === 0) return undefined;
  // Each call on the instance it is made on; a receiver handed in, once per caller handing it one (P329).
  const told = calls.map((call) => {
    const receiver = receiverOf(call);
    return receiver === undefined ? undefined : toldWalks(receiver, walk)?.map((each) => ({ call, walk: each }));
  });
  if (told.some((each) => each === undefined)) return undefined;
  return union(
    told.flatMap((each) => each ?? []).map(({ call, walk: each }) => holderValuesAt(declaration, at, keys, depth + 1, { ...each, bound: new Map([...each.bound, [method, call]]) })),
  );
};

/** One value a holder may be given otherwise than by a setter: its initializer, an assignment, a key `Object.assign` lays over it. */
interface Written {
  readonly value: TsNode;
  /** The assignment or the call; none for the initializer. */
  readonly write?: TsNode;
  /** The key of `value` the holder is given, for a key `Object.assign` lays over it (P327). */
  readonly under?: readonly string[];
  /** The call a function assigning into its parameter was handed the holder's object by: its parameters are that call's arguments (P329). */
  readonly bound?: Handing;
}

/**
 * What the values a holder is given otherwise than by a setter answer at a
 * path, read at `at` (P327): each one read under `own`; of the writes made in
 * the read's own block before it, the last one read whole stands for those
 * before it there, and for what the holder starts with (`open` where it may
 * start with nothing). A write whose value is not read is said.
 */
const writtenValuesAt = (
  written: readonly Written[],
  at: TsNode,
  keys: readonly string[],
  depth: number,
  walk: Walk,
  own: Walk,
  options: { readonly builder?: TsNode; readonly startsEmpty?: true } = {},
): Values => {
  const reads = written.map((each) => {
    const path = [...(each.under ?? []), ...keys];
    const under = each.bound === undefined ? own : { ...own, bound: new Map([...own.bound, [each.bound.fn, each.bound.call]]) };
    const read = valuesAt(each.value, path, depth + 1, under);
    const found = each.bound === undefined ? read : { found: marked(read.found, { handedAt: each.bound.call }), open: read.open };
    return { ...each, read: found, clear: each.write === undefined || readable(each.value, read, path) };
  });
  // The last write of the read's own block made before it, read whole, stands for the ones before it there (P327).
  const scope = scopeOf(at);
  const inBlock = (write: TsNode | undefined): boolean =>
    write !== undefined && write.getSourceFile() === at.getSourceFile() && write.getEnd() <= at.getStart() && scopeOf(write) === scope && surelyBefore(write, at);
  const cut = reads
    .filter((each) => inBlock(each.write) && each.clear && !each.read.open)
    .sort((a, b) => (b.write?.getStart() ?? 0) - (a.write?.getStart() ?? 0))[0];
  const cutBlock = cut === undefined ? reads : reads.filter((each) => each === cut || (each.write !== undefined && !(inBlock(each.write) && each.write.getStart() < (cut.write?.getStart() ?? 0))));
  // A write the constructor surely makes, read whole, is what every instance starts with in place of the initializer (P327).
  const builder = options.builder;
  const constructed = (write: TsNode | undefined): boolean =>
    builder !== undefined &&
    Node.isConstructorDeclaration(builder) &&
    write !== undefined &&
    scope !== builder &&
    write.getParent()?.getParent() === builder.getBody() &&
    Node.isExpressionStatement(write.getParent());
  const kept = cutBlock.some((each) => constructed(each.write) && each.clear && !each.read.open) ? cutBlock.filter((each) => each.write !== undefined) : cutBlock;
  for (const each of kept) {
    // A write whose value is not read leaves the holder's value unknown from there on (P321).
    if (each.write !== undefined && !each.clear) walk.sink.rewrittenAt ??= each.write;
  }
  const below = union(kept.map((each) => each.read));
  return options.startsEmpty === true && cut === undefined ? { found: below.found, open: true } : below;
};

/**
 * What a key of an object literal a variable holds is at a path where it is
 * read, the key being one the literal does not declare (P329): `const config:
 * Config = {}; config.port = 4000`. Each write of the key, and each key
 * `Object.assign` lays over the object, is a value it may hold, as a
 * property's are ({@link holderValuesAt}); the object starts without it, so
 * where no write in the read's own block surely comes first, it may be absent.
 */
const keyValuesAt = (literal: TsNode, key: string, at: TsNode, keys: readonly string[], depth: number, walk: Walk): Values => {
  const written: Written[] = [
    ...keyWritesOf(literal, key).flatMap((write) => placedWrites(write, literal, at)),
    ...assignsInto(literal.getSourceFile(), key, ownedBy(literal)).map((assigned) => ({
      value: assigned.value,
      write: assigned.call,
      under: assigned.under,
      ...(assigned.bound === undefined ? {} : { bound: assigned.bound }),
    })),
  ];
  return writtenValuesAt(written, at, keys, depth, walk, walk, { startsEmpty: true });
};

/**
 * What a variable of a module, or a property, holds at a path, read at `at`
 * (P315, P321). Its initializer and every assignment that is not a setter's
 * are the values it may hold, each one - a constructor's write among them,
 * its parameters what each `new` hands; a setter's write - a merge over the
 * holder itself (`active = mergeConfig(active, given)`,
 * `this.config = mergeConfig(this.config, given)`), or the plain write of a
 * parameter (`active = given`) - is laid over them once per call of the
 * setter made before the read, the latest on top, each call's own argument
 * for the parameter. A write in an unnamed callback is the named function's
 * it is written in. A value read below a merge says it was read through it.
 * A variable of a function is read by {@link localValuesAt}.
 *
 * In place (P327): a key `Object.assign(config, { port })` lays over the
 * object holding the property is a write of it (`Object.assign(this, opts)`
 * of a field), and so is `config.server.port = 4000` of a key nested in the
 * object a variable holds; of the writes made in the read's own block before
 * it, the last one read is what it holds, the initializer and the earlier
 * ones there no longer. A field of a class is read per instance: on an
 * instance the read is told to be of, only that instance's setter calls are
 * laid over it and a constructor's write is read for its own `new`; a field
 * read through `this` in a method reached by no call is read once per call
 * of the method ({@link perCallOfMethod}).
 */
const holderValuesAt = (declaration: TsNode, at: TsNode, keys: readonly string[], depth: number, walk: Walk): Values => {
  if (holderKindOf(declaration) === 'local') return localValuesAt(declaration, at, keys, depth, walk);
  const perCall = perCallOfMethod(declaration, at, keys, depth, walk);
  if (perCall !== undefined) return perCall;
  // The instance a field is read on, where it is told (P327).
  const instance = isInstanceField(declaration) && Node.isPropertyAccessExpression(at) ? instanceOf(at.getExpression(), walk) : undefined;
  const ofInstance = (call: Invocation): boolean => {
    if (instance === undefined) return true;
    const receiver = receiverOf(call);
    const other = receiver === undefined ? undefined : instanceOf(receiver, walk);
    return other === undefined || other === instance;
  };
  const holds = (node: TsNode): boolean => refersTo(node, declaration);
  const written: Written[] = [];
  const initializer =
    Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) || Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
  if (initializer !== undefined) written.push({ value: initializer });
  const setters: SetterWrite[] = [];
  let mergedAt: TsNode | undefined;
  for (const write of writesOf(declaration)) {
    const value = write.getRight();
    const scope = setterScopeOf(write);
    const call = unwrapped(value);
    const helper = Node.isCallExpression(call) ? ownFunction(call.getExpression()) : undefined;
    if (Node.isCallExpression(call) && helper !== undefined && isMergeHelper(helper) && call.getArguments().some(holds)) {
      mergedAt ??= call;
      setters.push({ scope, layers: call.getArguments().filter((each) => !holds(each)), mergedAt: call });
      continue;
    }
    // `this.values = { ...this.values, ...given }`: a merge written in place over the holder itself (P321).
    if (Node.isObjectLiteralExpression(call) && call.getProperties().some((each) => Node.isSpreadAssignment(each) && holds(each.getExpression()))) {
      mergedAt ??= call;
      setters.push({ scope, layers: [call], mergedAt: call, spreads: true });
      continue;
    }
    // A constructor's write is the value each instance starts with, its parameters what each `new` hands (P321).
    if (!Node.isSourceFile(scope) && !Node.isConstructorDeclaration(scope) && namesParameterOf(value, scope)) {
      setters.push({ scope, layers: [value], replaces: true });
      continue;
    }
    // A key of a literal written through a parameter is made where the call handing it in is (P335).
    if (Node.isPropertyAssignment(declaration)) written.push(...placedWrites(write, declaration.getParent(), at));
    else written.push({ value, write });
  }
  for (const assigned of assignedOf(declaration)) {
    written.push({ value: assigned.value, write: assigned.call, under: assigned.under, ...(assigned.bound === undefined ? {} : { bound: assigned.bound }) });
  }
  const points = [at, ...[...walk.via].reverse()];
  interface Made {
    readonly setter: SetterWrite;
    readonly place: TsNode;
    readonly call?: Invocation;
  }
  const made = setters
    .flatMap((setter): Made[] =>
      Node.isSourceFile(setter.scope)
        ? [{ setter, place: setter.layers[0] ?? setter.scope }]
        : callsOf(setter.scope)
            .filter((call) => precedes(call, points) && ofInstance(call))
            .map((call) => ({ setter, place: call, call })),
    )
    .sort((a, b) => byPlace(a.place, b.place));
  const layers: Layer[] = made.reverse().flatMap(({ setter, call }) => {
    const bound: Walk = call === undefined ? walk : { ...walk, bound: new Map([...walk.bound, [setter.scope, call]]) };
    const inner: Walk = setter.spreads === true ? { ...bound, beneath: declaration } : bound;
    return [...setter.layers].reverse().map((node) => ({
      node,
      walk: inner,
      ...(setter.mergedAt === undefined ? {} : { mergedAt: setter.mergedAt }),
      ...(call === undefined ? {} : { handedAt: call }),
      ...(setter.replaces === true ? { replaces: true as const } : {}),
    }));
  });
  const top = layered(layers, keys, depth, walk);
  if (!top.open) return top;
  // The instance's own `new` is the one its constructor's write is read for (P327).
  const born = instance === undefined ? undefined : newOf(instance);
  const constructor = isInstanceField(declaration) ? declaration.getParent()?.getChildrenOfKind(SyntaxKind.Constructor)[0] : undefined;
  const own: Walk = born === undefined || constructor === undefined ? walk : { ...walk, bound: new Map([...walk.bound, [constructor, born]]) };
  const below = writtenValuesAt(written, at, keys, depth, walk, own, constructor === undefined ? {} : { builder: constructor });
  return { found: [...top.found, ...marked(below.found, mergedAt === undefined ? {} : { mergedAt })], open: below.open };
};


/**
 * The access in an expression read off a variable or a property its code
 * writes after declaring it (P315, P321) - `active` of `active.api.port`,
 * `this.config` of `this.config.port` - and the keys read after it, or
 * undefined where the expression reads none.
 */
const heldIn = (expression: TsNode): { readonly base: TsNode; readonly keys: readonly string[] } | undefined => {
  const keys: string[] = [];
  let at = unwrapped(expression);
  for (let step = 0; step < DEPTH * 2; step++) {
    if (Node.isPropertyAccessExpression(at)) {
      if (at.getExpression().getText() === 'process.env') return undefined;
      if ((at.getNameNode().getSymbol()?.getDeclarations() ?? []).some((each) => holderOf(each) !== undefined) || keyHolderAt(at) !== undefined) return { base: at, keys };
      keys.unshift(at.getName());
      at = unwrapped(at.getExpression());
      continue;
    }
    if (!Node.isIdentifier(at)) return undefined;
    const symbol = at.getSymbol();
    return ((symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []).some((each) => holderOf(each) !== undefined) ? { base: at, keys } : undefined;
  }
  return undefined;
};

/**
 * The value at a path of what a call answers, or a variable or a property
 * its code writes holds (P305, P315, P321), `expression` an access of it
 * (`config.apiOptions`, `config` a constant holding the call; `this.config`)
 * and `more` the keys read after it. Where it may hold several values, the
 * first is followed and the others are kept on the trail.
 */
const throughMerge = (expression: TsNode, more: readonly string[], depth: number, trail: Trail | undefined): TsNode | undefined => {
  if (depth > DEPTH) return undefined;
  const held = heldIn(expression);
  const keys: string[] = held === undefined ? [] : [...held.keys];
  let base = held?.base ?? expression;
  if (held === undefined) {
    while (Node.isPropertyAccessExpression(base)) {
      keys.unshift(base.getName());
      base = base.getExpression();
    }
    // Only what a call answers or a holder holds: an object handed in as a
    // parameter is read where each caller hands it (P254).
    if (callBehind(base, depth + 1) === undefined) return undefined;
  }
  keys.push(...more);
  if (keys.length === 0 && held === undefined) return undefined;
  const value = adopt(valuesAt(base, keys, 0, walkFrom(trail)).found, trail);
  return value === undefined || value === base ? undefined : followed(value, depth + 1, trail);
};

/** A literal key of an access or a call: `process.env['PORT']`, `config.get('PORT')`. */
const literalText = (node: TsNode | undefined): string | undefined =>
  node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;

/** A number as code writes a port: `3001`, `'3001'`. */
const portNumber = (node: TsNode | undefined): number | undefined => {
  if (node === undefined) return undefined;
  const text = Node.isNumericLiteral(node) ? node.getText() : literalText(node);
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  const port = Number(text);
  return port > 0 && port < 65536 ? port : undefined;
};

/**
 * The setting an expression reads: `process.env.PORT`, `process.env['PORT']`,
 * and a configuration object's getter, `config.get('PORT')`, which reads the
 * same environment - or, where the adapter knows the settings it reads, what
 * it answers for the key (P254) - with the getter's own fallback,
 * `config.get('PORT', 3001)`, the second argument, first.
 */
const settingRead = (node: TsNode, reading: PortReading | undefined): WrittenPort | undefined => {
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() === 'process.env') return { setting: node.getName() };
  if (Node.isElementAccessExpression(node) && node.getExpression().getText() === 'process.env') {
    const setting = literalText(node.getArgumentExpression());
    return setting === undefined ? undefined : { setting };
  }
  if (!Node.isCallExpression(node) || !/\.(get|getOrThrow)$/.test(node.getExpression().getText())) return undefined;
  const key = literalText(node.getArguments()[0]);
  if (key === undefined) return undefined;
  const fallback = portNumber(followed(node.getArguments()[1]));
  const answered = reading?.settingOf?.(node, key);
  if (answered !== undefined && (answered.port !== undefined || answered.setting !== undefined)) {
    const port = fallback ?? answered.port;
    return { ...(answered.setting === undefined ? {} : { setting: answered.setting }), ...(port === undefined ? {} : { port }) };
  }
  if (!/config/i.test(node.getExpression().getText())) return undefined;
  return { setting: key, ...(fallback === undefined ? {} : { port: fallback }) };
};

/**
 * The port an expression is: a number, a constant holding one, a property of
 * a literal settings object, or a setting with the number it falls back to -
 * `process.env.PORT ?? 3001`, `Number(process.env.PORT) || 3001`,
 * `parseInt(process.env.PORT ?? '3001', 10)`, `config.get('PORT', 3001)`. A
 * setting with no fallback is the setting's value, which the repository's own
 * files give where they do (P77), and no port of the code's.
 */
export const portWritten = (written: TsNode | undefined, reading?: PortReading, depth = 0): WrittenPort => {
  const trail: Trail = {};
  const read = portRead(written, reading, depth, trail);
  return trail.mergedAt === undefined ? read : { ...read, mergedAt: trail.mergedAt };
};

const portRead = (written: TsNode | undefined, reading: PortReading | undefined, depth: number, trail: Trail): WrittenPort => {
  const node = followed(written, 0, trail);
  if (node === undefined || depth > DEPTH) return {};
  const number = portNumber(node);
  if (number !== undefined) return { port: number };
  const setting = settingRead(node, reading);
  if (setting !== undefined) return setting;
  if (Node.isPropertyAccessExpression(node)) {
    const answered = reading?.propertyOf?.(node);
    if (answered !== undefined) return answered;
  }
  if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
    const left = portRead(node.getLeft(), reading, depth + 1, trail);
    const right = portRead(node.getRight(), reading, depth + 1, trail);
    const port = left.port ?? right.port;
    return { ...(left.setting === undefined ? {} : { setting: left.setting }), ...(port === undefined ? {} : { port }) };
  }
  if (Node.isCallExpression(node) && /^(Number|parseInt|parseFloat)$/.test(node.getExpression().getText())) {
    return portRead(node.getArguments()[0], reading, depth + 1, trail);
  }
  if (Node.isPrefixUnaryExpression(node)) return portRead(node.getOperand(), reading, depth + 1, trail);
  return {};
};

/** The port in an options object, `{ port: 3001 }`, or the expression itself. */
export const portIn = (argument: TsNode | undefined, key = 'port', reading?: PortReading): WrittenPort => {
  const node = followed(argument);
  if (node !== undefined && Node.isObjectLiteralExpression(node)) {
    const property = node.getProperty(key);
    // `{ port }` names the property; the value is the variable of that name.
    const value = property === undefined ? undefined : propertyValue(property);
    return value === undefined ? {} : portWritten(value, reading);
  }
  return portWritten(node, reading);
};

/** Whether a reading says anything: a number, or a setting named as a variable of the environment. */
const says = (read: WrittenPort): boolean => read.port !== undefined || (read.setting !== undefined && isEnvironmentName(read.setting));

/** A port read at a node, or nothing where neither a number nor a setting of the environment was read. */
export const listenAt = (
  read: WrittenPort,
  at: TsNode,
  extra: { readonly default?: true; readonly handedAt?: TsNode; readonly devServer?: true } = {},
): ListenAt | undefined =>
  !says(read)
    ? undefined
    : {
        ...(read.port === undefined ? {} : { port: read.port }),
        at,
        ...(read.setting === undefined ? {} : { setting: read.setting }),
        ...(read.mergedAt === undefined ? {} : { mergedAt: read.mergedAt }),
        ...extra,
      };

/** How many functions a port is followed back through, from the one that starts the server. */
const HANDED_DEPTH = 3;

interface Parameter {
  /** The function, its parameters as written. */
  readonly fn: TsNode;
  readonly index: number;
  /** The property of an object handed in that is read: `{ port }`, `options.port`. */
  readonly key?: string;
  /** The default the parameter's pattern gives the key, `{ port = 3001 }` (P315). */
  readonly otherwise?: TsNode;
}

const parametersOf = (fn: TsNode): readonly TsNode[] =>
  Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) || Node.isConstructorDeclaration(fn)
    ? fn.getParameters()
    : [];

/** The parameter a declaration is, and the key of it read where it is destructured: `port`, `{ port }`. */
const parameterAt = (declaration: TsNode | undefined, key: string | undefined): Parameter | undefined => {
  if (declaration === undefined) return undefined;
  if (Node.isParameterDeclaration(declaration)) {
    const fn = declaration.getParent();
    return { fn, index: parametersOf(fn).indexOf(declaration), ...(key === undefined ? {} : { key }) };
  }
  if (Node.isBindingElement(declaration) && key === undefined) {
    const pattern = declaration.getParent();
    const parameter = pattern.getParent();
    if (!Node.isObjectBindingPattern(pattern) || !Node.isParameterDeclaration(parameter)) return undefined;
    const fn = parameter.getParent();
    const otherwise = declaration.getInitializer();
    return {
      fn,
      index: parametersOf(fn).indexOf(parameter),
      key: declaration.getPropertyNameNode()?.getText() ?? declaration.getName(),
      ...(otherwise === undefined ? {} : { otherwise }),
    };
  }
  return undefined;
};

/** The parameter an expression reads: `port`, a name destructured from one, `options.port`. */
const parameterOf = (node: TsNode): Parameter | undefined => {
  if (Node.isPropertyAccessExpression(node)) {
    const object = node.getExpression();
    return Node.isIdentifier(object) ? parameterAt(object.getSymbol()?.getDeclarations()[0], node.getName()) : undefined;
  }
  return Node.isIdentifier(node) ? parameterAt(node.getSymbol()?.getDeclarations()[0], undefined) : undefined;
};

/** The name a function is called by: its own, or the constant or the property it is assigned to (P321). */
const nameOfFunction = (fn: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  const parent = fn.getParent();
  const named = parent !== undefined && (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent));
  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && named) return parent.getNameNode();
  return undefined;
};

/** A call of a function, or a `new` of a class, whose arguments are the parameters' (P321). */
type Invocation = CallExpression | NewExpression;

/** Every `new` of the class a constructor belongs to, outside tests (P321). */
const newsOf = (constructor: TsNode): NewExpression[] => {
  const owner = constructor.getParent();
  const name = owner !== undefined && Node.isClassDeclaration(owner) ? owner.getNameNode() : undefined;
  if (name === undefined) return [];
  return name.findReferencesAsNodes().flatMap((found) => {
    if (isTestName(found.getSourceFile().getBaseName()) || !Node.isIdentifier(found)) return [];
    const made = found.getParent();
    return made !== undefined && Node.isNewExpression(made) && made.getExpression() === found ? [made] : [];
  });
};

/** Every call of a function in the repository's files, outside tests: `start(3001)`, `servers.start(3001)`. */
const callsOf = (fn: TsNode): Invocation[] => {
  if (Node.isConstructorDeclaration(fn)) return newsOf(fn);
  const name = nameOfFunction(fn);
  if (name === undefined || !Node.isIdentifier(name)) return [];
  return name.findReferencesAsNodes().flatMap((found) => {
    if (isTestName(found.getSourceFile().getBaseName())) return [];
    // A reference at the start of a statement can come back as the statement;
    // the name is the identifier it starts with.
    const reference = Node.isIdentifier(found)
      ? found
      : found.getFirstDescendant((each) => Node.isIdentifier(each) && each.getStart() === found.getStart() && each.getText() === name.getText());
    if (reference === undefined) return [];
    const parent = reference.getParent();
    const callee = parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference ? parent : reference;
    const call = callee.getParent();
    return call !== undefined && Node.isCallExpression(call) && call.getExpression() === callee ? [call] : [];
  });
};

interface Handed {
  readonly read: WrittenPort;
  readonly handedAt?: TsNode;
}

/**
 * What each call of the function a parameter belongs to hands it, read as a
 * port, and its default where a call hands nothing, or hands an object
 * leaving the key out, or nobody calls it (P315): `start(port = 3001)`,
 * `start({ port = 3001 })`, `start(options = { port: 3001 })`.
 */
const fromParameter = (parameter: Parameter | undefined, reading: PortReading | undefined, depth: number, sink?: Trail): Handed[] => {
  if (parameter === undefined || parameter.index < 0 || depth >= HANDED_DEPTH) return [];
  const declared = parametersOf(parameter.fn)[parameter.index];
  const fallback = (): Handed[] => {
    if (parameter.otherwise !== undefined) return handedPorts(parameter.otherwise, undefined, reading, depth + 1, sink);
    const own = declared !== undefined && Node.isParameterDeclaration(declared) ? declared.getInitializer() : undefined;
    return own === undefined ? [] : handedPorts(own, parameter.key, reading, depth + 1, sink);
  };
  const calls = callsOf(parameter.fn);
  if (calls.length === 0) return fallback();
  return calls.flatMap((call) => {
    const argument = call.getArguments()[parameter.index];
    if (argument === undefined) return fallback();
    // The call nearest the number is where it is handed in.
    const handed = handedPorts(argument, parameter.key, reading, depth + 1, sink).map((each) => ({ ...each, handedAt: each.handedAt ?? call }));
    if (handed.length > 0 || parameter.key === undefined) return handed;
    const given = followed(argument);
    return given !== undefined && Node.isObjectLiteralExpression(given) && given.getProperty(parameter.key) === undefined ? fallback() : handed;
  });
};

/**
 * Every port an argument is, followed to where it is written (P254): the
 * number or setting it is, or - where it is a parameter of the function it is
 * in - what each call of that function hands in, through up to three
 * functions. An options object is read at `key` (`port` where none is asked).
 * Where the argument may hold several values - each caller's, each value a
 * module variable is written (P315) - every one of them is read.
 */
const handedPorts = (argument: TsNode | undefined, key: string | undefined, reading: PortReading | undefined, depth: number, sink?: Trail): Handed[] => {
  if (depth > DEPTH) return [];
  const trail: Trail = sink?.readAt === undefined ? {} : { readAt: sink.readAt };
  const node = followed(argument, 0, trail);
  if (sink !== undefined && trail.unreadAt !== undefined) sink.unreadAt ??= trail.unreadAt;
  if (sink !== undefined && trail.rewrittenAt !== undefined) sink.rewrittenAt ??= trail.rewrittenAt;
  const own = node === undefined ? [] : handedNode(node, trail, key, reading, depth, sink);
  const others = (trail.others ?? []).flatMap((other) =>
    handedPorts(other.value, key, reading, depth + 1, sink).map((each) => {
      const handedAt = each.handedAt ?? other.handedAt;
      const read = each.read.mergedAt !== undefined || other.mergedAt === undefined ? each.read : { ...each.read, mergedAt: other.mergedAt };
      return handedAt === undefined ? { read } : { read, handedAt };
    }),
  );
  return [...own, ...others];
};

/** Every port the values a holder may hold are, each saying the merge it was read through and the call that handed it. */
const heldPorts = (held: Values, reading: PortReading | undefined, depth: number, sink: Trail | undefined): Handed[] =>
  held.found.flatMap((each) =>
    handedPorts(each.value, undefined, reading, depth + 1, sink).map((handed) => {
      const read = handed.read.mergedAt !== undefined || each.mergedAt === undefined ? handed.read : { ...handed.read, mergedAt: each.mergedAt };
      const handedAt = handed.handedAt ?? each.handedAt;
      return handedAt === undefined ? { read } : { read, handedAt };
    }),
  );

/** Every port one followed value is: {@link handedPorts} past following. */
const handedNode = (node: TsNode, trail: Trail, key: string | undefined, reading: PortReading | undefined, depth: number, sink: Trail | undefined): Handed[] => {
  if (Node.isObjectLiteralExpression(node)) {
    const property = node.getProperty(key ?? 'port');
    // A key the literal does not declare, written after it (P329): each value it may hold there.
    if (property === undefined) {
      const written = key ?? 'port';
      if (keyWritesOf(node, written).length === 0 && assignsInto(node.getSourceFile(), written, ownedBy(node)).length === 0) return [];
      return heldPorts(keyValuesAt(node, written, sink?.readAt ?? node, [], 0, walkFrom(sink)), reading, depth, sink);
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      // `{ port }`: a constant of that name, or a parameter handed in.
      const declaration = property.getValueSymbol()?.getDeclarations()[0];
      // A variable or a parameter written again before the read: what it holds there (P321).
      if (declaration !== undefined && holderOf(declaration) !== undefined) {
        const held = declaredValuesAt(declaration, property.getNameNode(), [], 0, walkFrom(sink)) ?? NOTHING;
        return held.found.flatMap((each) =>
          handedPorts(each.value, undefined, reading, depth + 1, sink).map((handed) => {
            const read = handed.read.mergedAt !== undefined || each.mergedAt === undefined ? handed.read : { ...handed.read, mergedAt: each.mergedAt };
            const handedAt = handed.handedAt ?? each.handedAt;
            return handedAt === undefined ? { read } : { read, handedAt };
          }),
        );
      }
      if (declaration !== undefined && Node.isVariableDeclaration(declaration)) return handedPorts(declaration.getInitializer(), undefined, reading, depth, sink);
      return fromParameter(parameterAt(declaration, undefined), reading, depth, sink);
    }
    // A key written after the object is declared, `config.port = 4000`, `Object.assign(config, { port })`: each value it may hold there (P327).
    if (Node.isPropertyAssignment(property) && holderOf(property) !== undefined) {
      return heldPorts(holderValuesAt(property, sink?.readAt ?? node, [], 0, walkFrom(sink)), reading, depth, sink);
    }
    return handedPorts(propertyValue(property), undefined, reading, depth, sink);
  }
  // `Number(port)`, `+port`: each value the number is made of, every caller's included (P321).
  const converted = Node.isCallExpression(node) && /^(?:Number|parseInt|parseFloat)$/.test(node.getExpression().getText()) ? node.getArguments()[0] : Node.isPrefixUnaryExpression(node) ? node.getOperand() : undefined;
  if (key === undefined && converted !== undefined) {
    return handedPorts(converted, undefined, reading, depth + 1, sink).map((each) => {
      const handedAt = each.handedAt ?? trail.handedAt;
      const read = trail.mergedAt === undefined || each.read.mergedAt !== undefined ? each.read : { ...each.read, mergedAt: trail.mergedAt };
      return handedAt === undefined ? { read } : { read, handedAt };
    });
  }
  const written = key === undefined ? portWritten(node, reading) : {};
  // A port read through a merge helper on the way here says so (P305).
  const read = trail.mergedAt === undefined || written.mergedAt !== undefined ? written : { ...written, mergedAt: trail.mergedAt };
  if (says(read)) return [trail.handedAt === undefined ? { read } : { read, handedAt: trail.handedAt }];
  const parameter = parameterOf(node);
  if (parameter === undefined) return [];
  // `options.port` of a parameter is already read at its key; a second key is
  // an object inside an object, which no call hands in as a port.
  if (parameter.key !== undefined && key !== undefined) return [];
  return fromParameter(key === undefined ? parameter : { ...parameter, key }, reading, depth, sink);
};

/**
 * What is said where the port a server is started with could not be read
 * (P315), or was read only as far as a write not read (P321).
 */
export interface PortUnread {
  /** The call that starts the server. */
  readonly at: TsNode;
  /**
   * The load of a module by a path decided at run time, that the port was to
   * come from (`loaded`); or a write of the value it is read from, whose own
   * value is not read (`rewritten`).
   */
  readonly from: TsNode;
  readonly how?: 'loaded' | 'rewritten';
  /** Whether ports were read all the same, from before the write: a guess (P321). */
  readonly guessed?: true;
}

/**
 * Every port the argument a server is started with says, read at `at`: what
 * it is written as, or what each call hands in where it is a parameter
 * (P254). `key` reads an options object at a property other than `port`.
 * Where nothing is read and the value was to come from a module loaded by a
 * path decided at run time, `unread` is told (P315).
 */
export const listensIn = (
  argument: TsNode | undefined,
  at: TsNode,
  options: { readonly key?: string; readonly reading?: PortReading; readonly unread?: (unread: PortUnread) => void } = {},
): ListenAt[] => {
  const sink: Trail = { readAt: at };
  const read = handedPorts(argument, options.key, options.reading, 0, sink).flatMap(({ read: each, handedAt }) => {
    const port = listenAt(each, at, handedAt === undefined ? {} : { handedAt });
    return port === undefined ? [] : [port];
  });
  // Ports read past a write whose value is not read are the values from before it, a guess (P321).
  const rewrittenAt = sink.rewrittenAt;
  const found = rewrittenAt === undefined ? read : read.map((port) => ({ ...port, rewrittenAt }));
  if (found.length === 0 && sink.unreadAt !== undefined) options.unread?.({ at, from: sink.unreadAt, how: 'loaded' });
  else if (found.length === 0 && rewrittenAt !== undefined) options.unread?.({ at, from: rewrittenAt, how: 'rewritten' });
  else if (rewrittenAt !== undefined) options.unread?.({ at, from: rewrittenAt, how: 'rewritten', guessed: true });
  return found;
};

/**
 * Every `<server>.listen(port)` in some files: `app.listen(3001)`,
 * `app.listen({ port })`, `http.createServer(app).listen(port, host)`,
 * `await app.listen(process.env.PORT ?? 3000)`. Node's own server and every
 * framework built on it spell it so. Only where the first argument reads as a
 * port: `listen()` with none asks the system for any port. A port handed in
 * from outside is read where each call hands it (P254), and a setting alone is
 * kept for the setting files to fill. A test file's server is the test's.
 */
export const listenCallsIn = (sources: Iterable<SourceFile>, reading?: PortReading, unread?: (unread: PortUnread) => void): ListenAt[] => {
  const found: ListenAt[] = [];
  for (const sourceFile of sources) {
    if (isTestName(sourceFile.getBaseName())) continue;
    if (!sourceFile.getFullText().includes('.listen(')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'listen') return;
      found.push(...listensIn(node.getArguments()[0], node, { ...(reading === undefined ? {} : { reading }), ...(unread === undefined ? {} : { unread }) }));
    });
  }
  return found;
};

/**
 * The row for a server whose port was to come from a module loaded by a path
 * decided at run time (P315): defaults kept in `settings-defaults` and loaded by
 * `import(path.join(__dirname, 'settings-defaults'))`, which nothing reads.
 */
export const portUnreadRow = (unread: PortUnread, repoDir: string): Unresolved => {
  const starts = unread.at.getText().split('\n')[0] ?? '';
  const from = `${unread.from.getText().split('\n')[0]} (${normalizeFilePath(unread.from.getSourceFile().getFilePath(), repoDir)}:${startLineOf(unread.from)})`;
  const place = { file: normalizeFilePath(unread.at.getSourceFile().getFilePath(), repoDir), line: startLineOf(unread.at), symbol: starts };
  // The value the port is read from is written again by something not read (P321): a guess where ports were read from before it.
  if (unread.how === 'rewritten' && unread.guessed === true) {
    return {
      ...place,
      reason: 'listen-port-guessed',
      level: 'info',
      message: `${starts} is read listening on the port the value it reads held before ${from}, a guess: what that write puts there is not read.`,
      hint: "Write the port where the server is started, or keep the write to a function of the repository's own whose answer can be read; a port a setting gives can be read from the repository's setting files.",
    };
  }
  if (unread.how === 'rewritten') {
    return {
      ...place,
      reason: 'listen-port-unread',
      level: 'info',
      message: `${starts} listens on a port this did not read: the value it is read from is written by ${from}, whose value is not read, so no request to this machine is joined to the service by its port.`,
      hint: "Write the port where the server is started, or keep the write to a function of the repository's own whose answer can be read; a port a setting gives can be read from the repository's setting files.",
    };
  }
  return {
    ...place,
    reason: 'listen-port-unread',
    level: 'info',
    message: `${starts} listens on a port this did not read: it comes from a module loaded by a path decided at run time, ${from}, so no request to this machine is joined to the service by its port.`,
    hint: "Import the module the port comes from by a path written as a string or built from the file's own directory (path.join(__dirname, 'defaults')), or write the port where the server is started; a port a setting gives can be read from the repository's setting files.",
  };
};

/** A port read at a node, placed in the repository. */
export const placedPort = (read: ListenAt, repoDir: string): ListenPort => ({
  ...(read.port === undefined ? {} : { port: read.port }),
  file: normalizeFilePath(read.at.getSourceFile().getFilePath(), repoDir),
  line: startLineOf(read.at),
  ...(read.setting === undefined ? {} : { setting: read.setting }),
  ...(read.default === undefined ? {} : { default: read.default }),
  ...(read.handedAt === undefined
    ? {}
    : { handed: `${normalizeFilePath(read.handedAt.getSourceFile().getFilePath(), repoDir)}:${startLineOf(read.handedAt)}` }),
  ...(read.devServer === undefined ? {} : { devServer: read.devServer }),
  ...(read.mergedAt === undefined
    ? {}
    : { merged: `${normalizeFilePath(read.mergedAt.getSourceFile().getFilePath(), repoDir)}:${startLineOf(read.mergedAt)}` }),
  ...(read.rewrittenAt === undefined
    ? {}
    : { rewritten: `${normalizeFilePath(read.rewrittenAt.getSourceFile().getFilePath(), repoDir)}:${startLineOf(read.rewrittenAt)}` }),
});

/**
 * Every port the service's server listens on, as the entry adapters that read
 * it say (P250): each detected adapter that knows where its framework's server
 * starts answers `listens`, and a front end's adapter for its dev server too
 * (P254). Two adapters reading one line agree by construction, so each port
 * is kept once per file, line and call that hands it, in the order of the files.
 */
export const listeningOf = (ctx: ExtractContext): ListenPort[] => {
  const seen = new Map<string, ListenPort>();
  // A context built for entry adapters alone has no frontend slot to ask.
  for (const adapter of [...ctx.adapters.entry, ...(ctx.adapters.frontend ?? [])]) {
    for (const port of adapter.listens?.(ctx) ?? []) {
      const key = [port.port ?? '', port.setting ?? '', port.file, port.line, port.handed ?? ''].join('\0');
      if (!seen.has(key)) seen.set(key, port);
    }
  }
  const order = (a: ListenPort, b: ListenPort): number =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.port ?? 0) - (b.port ?? 0) || (a.handed ?? '').localeCompare(b.handed ?? '');
  return [...seen.values()].sort(order);
};
