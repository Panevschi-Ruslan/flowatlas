import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ExtractContext } from './adapters/context.js';
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
}

/** What an expression says of a port: the number, and the setting it falls back from. */
export interface WrittenPort {
  readonly port?: number;
  readonly setting?: string;
}

/**
 * What a reader that knows a settings library adds to the reading of a port
 * (P254): the value a settings getter answers for a key, `config.get('app.port')`,
 * where the library builds it from a factory or a schema the core does not know.
 */
export interface PortReading {
  readonly settingOf?: (call: CallExpression, key: string) => WrittenPort | undefined;
}

/** Whether a port is written as a number the server listens on wherever it runs. */
export const literalPort = (port: Pick<ListenPort, 'setting' | 'default'>): boolean => port.setting === undefined && port.default !== true;

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

/** An expression through the names and wrappers in front of it: a constant's value. */
const followed = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > DEPTH) return node;
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node)) {
    return followed(node.getExpression(), depth + 1);
  }
  // `config.port`, `settings.server.port`: the property where a literal
  // object declares it, in this file or another (P254). `process.env.PORT` is
  // a setting, read as one below.
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() !== 'process.env') {
    for (const declaration of node.getNameNode().getSymbol()?.getDeclarations() ?? []) {
      const value = propertyValue(declaration);
      if (value !== undefined) return followed(value, depth + 1);
    }
    return node;
  }
  if (!Node.isIdentifier(node)) return node;
  const symbol = node.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return followed(initializer, depth + 1);
    }
    // `const { port } = config`: the property of the object it is taken from.
    const taken = destructured(declaration, depth);
    if (taken !== undefined) return taken;
  }
  return node;
};

/** The value a name destructured from a literal object is: `const { port } = { port: 3001 }`. */
const destructured = (element: TsNode, depth: number): TsNode | undefined => {
  if (!Node.isBindingElement(element)) return undefined;
  const pattern = element.getParent();
  const declaration = pattern.getParent();
  if (!Node.isObjectBindingPattern(pattern) || !Node.isVariableDeclaration(declaration)) return undefined;
  const from = followed(declaration.getInitializer(), depth + 1);
  if (from === undefined || !Node.isObjectLiteralExpression(from)) return undefined;
  const property = from.getProperty(element.getPropertyNameNode()?.getText() ?? element.getName());
  const value = property === undefined ? undefined : propertyValue(property);
  return value === undefined ? undefined : followed(value, depth + 1);
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
  const node = followed(written);
  if (node === undefined || depth > DEPTH) return {};
  const number = portNumber(node);
  if (number !== undefined) return { port: number };
  const setting = settingRead(node, reading);
  if (setting !== undefined) return setting;
  if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
    const left = portWritten(node.getLeft(), reading, depth + 1);
    const right = portWritten(node.getRight(), reading, depth + 1);
    const port = left.port ?? right.port;
    return { ...(left.setting === undefined ? {} : { setting: left.setting }), ...(port === undefined ? {} : { port }) };
  }
  if (Node.isCallExpression(node) && /^(Number|parseInt|parseFloat)$/.test(node.getExpression().getText())) {
    return portWritten(node.getArguments()[0], reading, depth + 1);
  }
  if (Node.isPrefixUnaryExpression(node)) return portWritten(node.getOperand(), reading, depth + 1);
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
    : { ...(read.port === undefined ? {} : { port: read.port }), at, ...(read.setting === undefined ? {} : { setting: read.setting }), ...extra };

/** How many functions a port is followed back through, from the one that starts the server. */
const HANDED_DEPTH = 3;

interface Parameter {
  /** The function, its parameters as written. */
  readonly fn: TsNode;
  readonly index: number;
  /** The property of an object handed in that is read: `{ port }`, `options.port`. */
  readonly key?: string;
}

const parametersOf = (fn: TsNode): readonly TsNode[] =>
  Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) ? fn.getParameters() : [];

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
    return { fn, index: parametersOf(fn).indexOf(parameter), key: declaration.getPropertyNameNode()?.getText() ?? declaration.getName() };
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

/** The name a function is called by: its own, or the constant it is assigned to. */
const nameOfFunction = (fn: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  const parent = fn.getParent();
  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && parent !== undefined && Node.isVariableDeclaration(parent)) return parent.getNameNode();
  return undefined;
};

/** Every call of a function in the repository's files, outside tests: `start(3001)`, `servers.start(3001)`. */
const callsOf = (fn: TsNode): CallExpression[] => {
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

/** What each call of the function a parameter belongs to hands it, read as a port. */
const fromParameter = (parameter: Parameter | undefined, reading: PortReading | undefined, depth: number): Handed[] => {
  if (parameter === undefined || parameter.index < 0 || depth >= HANDED_DEPTH) return [];
  return callsOf(parameter.fn).flatMap((call) =>
    // The call nearest the number is where it is handed in.
    handedPorts(call.getArguments()[parameter.index], parameter.key, reading, depth + 1).map((each) => ({ ...each, handedAt: each.handedAt ?? call })),
  );
};

/**
 * Every port an argument is, followed to where it is written (P254): the
 * number or setting it is, or - where it is a parameter of the function it is
 * in - what each call of that function hands in, through up to three
 * functions. An options object is read at `key` (`port` where none is asked).
 */
const handedPorts = (argument: TsNode | undefined, key: string | undefined, reading: PortReading | undefined, depth: number): Handed[] => {
  const node = followed(argument);
  if (node === undefined) return [];
  if (Node.isObjectLiteralExpression(node)) {
    const property = node.getProperty(key ?? 'port');
    if (property === undefined) return [];
    if (Node.isShorthandPropertyAssignment(property)) {
      // `{ port }`: a constant of that name, or a parameter handed in.
      const declaration = property.getValueSymbol()?.getDeclarations()[0];
      if (declaration !== undefined && Node.isVariableDeclaration(declaration)) return handedPorts(declaration.getInitializer(), undefined, reading, depth);
      return fromParameter(parameterAt(declaration, undefined), reading, depth);
    }
    return handedPorts(propertyValue(property), undefined, reading, depth);
  }
  const read = key === undefined ? portWritten(node, reading) : {};
  if (says(read)) return [{ read }];
  const parameter = parameterOf(node);
  if (parameter === undefined) return [];
  // `options.port` of a parameter is already read at its key; a second key is
  // an object inside an object, which no call hands in as a port.
  if (parameter.key !== undefined && key !== undefined) return [];
  return fromParameter(key === undefined ? parameter : { ...parameter, key }, reading, depth);
};

/**
 * Every port the argument a server is started with says, read at `at`: what
 * it is written as, or what each call hands in where it is a parameter
 * (P254). `key` reads an options object at a property other than `port`.
 */
export const listensIn = (
  argument: TsNode | undefined,
  at: TsNode,
  options: { readonly key?: string; readonly reading?: PortReading } = {},
): ListenAt[] =>
  handedPorts(argument, options.key, options.reading, 0).flatMap(({ read, handedAt }) => {
    const found = listenAt(read, at, handedAt === undefined ? {} : { handedAt });
    return found === undefined ? [] : [found];
  });

/**
 * Every `<server>.listen(port)` in some files: `app.listen(3001)`,
 * `app.listen({ port })`, `http.createServer(app).listen(port, host)`,
 * `await app.listen(process.env.PORT ?? 3000)`. Node's own server and every
 * framework built on it spell it so. Only where the first argument reads as a
 * port: `listen()` with none asks the system for any port. A port handed in
 * from outside is read where each call hands it (P254), and a setting alone is
 * kept for the setting files to fill. A test file's server is the test's.
 */
export const listenCallsIn = (sources: Iterable<SourceFile>, reading?: PortReading): ListenAt[] => {
  const found: ListenAt[] = [];
  for (const sourceFile of sources) {
    if (isTestName(sourceFile.getBaseName())) continue;
    if (!sourceFile.getFullText().includes('.listen(')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'listen') return;
      found.push(...listensIn(node.getArguments()[0], node, reading === undefined ? {} : { reading }));
    });
  }
  return found;
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
