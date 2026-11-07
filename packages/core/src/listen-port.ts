import type { Node as TsNode, SourceFile } from 'ts-morph';
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
 */

/** Where the repository node keeps the ports its server listens on. */
export const LISTEN_META = 'listen';

/** One port a service's server listens on, and where that is written. */
export interface ListenPort {
  readonly port: number;
  /** Repo-relative POSIX path. */
  readonly file: string;
  readonly line: number;
  /** The setting that moves it elsewhere when it is given: the port is its fallback. */
  readonly setting?: string;
  /** The port the server's library listens on where the code writes none. */
  readonly default?: true;
}

/** A port read at a node, before it is placed in a file. */
export interface ListenAt {
  readonly port: number;
  readonly at: TsNode;
  readonly setting?: string;
  readonly default?: true;
}

/** What an expression says of a port: the number, and the setting it falls back from. */
export interface WrittenPort {
  readonly port?: number;
  readonly setting?: string;
}

/** Whether a port is written as a number the server listens on wherever it runs. */
export const literalPort = (port: Pick<ListenPort, 'setting' | 'default'>): boolean => port.setting === undefined && port.default !== true;

const DEPTH = 6;

/** An expression through the names and wrappers in front of it: a constant's value. */
const followed = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > DEPTH) return node;
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node)) {
    return followed(node.getExpression(), depth + 1);
  }
  if (!Node.isIdentifier(node)) return node;
  const symbol = node.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return followed(initializer, depth + 1);
    }
  }
  return node;
};

/** A literal key of an access or a call: `process.env['PORT']`, `config.get('PORT')`. */
const literalText = (node: TsNode | undefined): string | undefined =>
  node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;

/**
 * The setting an expression reads: `process.env.PORT`, `process.env['PORT']`,
 * and a configuration object's getter, `config.get('PORT')`, which reads the
 * same environment.
 */
const settingRead = (node: TsNode): string | undefined => {
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() === 'process.env') return node.getName();
  if (Node.isElementAccessExpression(node) && node.getExpression().getText() === 'process.env') return literalText(node.getArgumentExpression());
  if (Node.isCallExpression(node) && /\.(get|getOrThrow)$/.test(node.getExpression().getText()) && /config/i.test(node.getExpression().getText())) {
    return literalText(node.getArguments()[0]);
  }
  return undefined;
};

/** A number as code writes a port: `3001`, `'3001'`. */
const portNumber = (node: TsNode | undefined): number | undefined => {
  if (node === undefined) return undefined;
  const text = Node.isNumericLiteral(node) ? node.getText() : literalText(node);
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  const port = Number(text);
  return port > 0 && port < 65536 ? port : undefined;
};

/**
 * The port an expression is: a number, a constant holding one, or a setting
 * with the number it falls back to - `process.env.PORT ?? 3001`,
 * `Number(process.env.PORT) || 3001`, `parseInt(process.env.PORT ?? '3001', 10)`,
 * `config.get('PORT', 3001)`. A setting with no fallback is the setting's
 * value, which the repository's own files give where they do (P77), and no
 * port of the code's.
 */
export const portWritten = (written: TsNode | undefined, depth = 0): WrittenPort => {
  const node = followed(written);
  if (node === undefined || depth > DEPTH) return {};
  const number = portNumber(node);
  if (number !== undefined) return { port: number };
  const setting = settingRead(node);
  if (setting !== undefined) {
    // `config.get('PORT', 3001)`: the fallback is the second argument.
    const fallback = Node.isCallExpression(node) ? portNumber(followed(node.getArguments()[1])) : undefined;
    return { setting, ...(fallback === undefined ? {} : { port: fallback }) };
  }
  if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
    const left = portWritten(node.getLeft(), depth + 1);
    const right = portWritten(node.getRight(), depth + 1);
    const port = left.port ?? right.port;
    return { ...(left.setting === undefined ? {} : { setting: left.setting }), ...(port === undefined ? {} : { port }) };
  }
  if (Node.isCallExpression(node) && /^(Number|parseInt|parseFloat)$/.test(node.getExpression().getText())) return portWritten(node.getArguments()[0], depth + 1);
  if (Node.isPrefixUnaryExpression(node)) return portWritten(node.getOperand(), depth + 1);
  return {};
};

/** The port in an options object, `{ port: 3001 }`, or the expression itself. */
export const portIn = (argument: TsNode | undefined, key = 'port'): WrittenPort => {
  const node = followed(argument);
  if (node !== undefined && Node.isObjectLiteralExpression(node)) {
    const property = node.getProperty(key);
    if (property === undefined) return {};
    if (Node.isPropertyAssignment(property)) return portWritten(property.getInitializer());
    if (Node.isShorthandPropertyAssignment(property)) {
      // `{ port }` names the property; the value is the variable of that name.
      const declaration = property.getValueSymbol()?.getDeclarations()[0];
      return declaration !== undefined && Node.isVariableDeclaration(declaration) ? portWritten(declaration.getInitializer()) : {};
    }
    return {};
  }
  return portWritten(node);
};

/** A port read at a node, or nothing where no number was read. */
export const listenAt = (read: WrittenPort, at: TsNode, extra: { readonly default?: true } = {}): ListenAt | undefined =>
  read.port === undefined ? undefined : { port: read.port, at, ...(read.setting === undefined ? {} : { setting: read.setting }), ...extra };

/**
 * Every `<server>.listen(port)` in some files: `app.listen(3001)`,
 * `app.listen({ port })`, `http.createServer(app).listen(port, host)`,
 * `await app.listen(process.env.PORT ?? 3000)`. Node's own server and every
 * framework built on it spell it so. Only where the first argument reads as a
 * port: `listen()` with none asks the system for any port, and a port handed
 * in from outside is not one this reading knows. A test file's server is the
 * test's.
 */
export const listenCallsIn = (sources: Iterable<SourceFile>): ListenAt[] => {
  const found: ListenAt[] = [];
  for (const sourceFile of sources) {
    if (isTestName(sourceFile.getBaseName())) continue;
    if (!sourceFile.getFullText().includes('.listen(')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'listen') return;
      const read = listenAt(portIn(node.getArguments()[0]), node);
      if (read !== undefined) found.push(read);
    });
  }
  return found;
};

/** A port read at a node, placed in the repository. */
export const placedPort = (read: ListenAt, repoDir: string): ListenPort => ({
  port: read.port,
  file: normalizeFilePath(read.at.getSourceFile().getFilePath(), repoDir),
  line: startLineOf(read.at),
  ...(read.setting === undefined ? {} : { setting: read.setting }),
  ...(read.default === undefined ? {} : { default: read.default }),
});

/**
 * Every port the service's server listens on, as the entry adapters that read
 * it say (P250): each detected adapter that knows where its framework's server
 * starts answers `listens`. Two adapters reading one line agree by
 * construction, so each port is kept once per file and line, in the order of
 * the files.
 */
export const listeningOf = (ctx: ExtractContext): ListenPort[] => {
  const seen = new Map<string, ListenPort>();
  for (const adapter of ctx.adapters.entry) {
    for (const port of adapter.listens?.(ctx) ?? []) {
      const key = `${port.port}\0${port.file}\0${port.line}`;
      if (!seen.has(key)) seen.set(key, port);
    }
  }
  return [...seen.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.port - b.port));
};
