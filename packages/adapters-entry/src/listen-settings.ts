import { isTestFile, normalizeFilePath, portWritten, type ExtractContext, type PortReading, type WrittenPort } from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { repoSources } from './shared.js';

/**
 * What a settings getter answers for a port (P254).
 *
 * `await app.listen(configService.get('app.port'))` names a key, and the key
 * is filled where the settings library is told how to build it. Two of those
 * are read here, beside the adapters whose servers read them:
 *
 * - NestJS's own: `registerAs('app', () => ({ port: Number(process.env.PORT) || 3004 }))`
 *   and a factory handed to `ConfigModule.forRoot({ load: [...] })`, read by
 *   their dotted keys (`app.port`), each leaf read as a port is
 *   (`portWritten`), so the setting it falls back from is kept;
 * - convict's: `convict({ port: { default: 3005, env: 'PORT' } })`, whose
 *   `config.get('port')` is the schema's default where the setting `env`
 *   names is not given.
 *
 * Nothing else is guessed: a key neither answers is the core's to read as it
 * always did (a getter of the environment, `config.get('PORT')`).
 */

const MAX_DEPTH = 6;

/** A name's value, through the constants in front of it. */
const valueOf = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > MAX_DEPTH) return node;
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) return valueOf(node.getExpression(), depth + 1);
  if (!Node.isIdentifier(node)) return node;
  const symbol = node.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined) return node;
  if (Node.isVariableDeclaration(declaration)) return valueOf(declaration.getInitializer(), depth + 1);
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isExportAssignment(declaration)) return valueOf(declaration.getExpression(), depth + 1);
  return node;
};

const keyOf = (name: TsNode): string | undefined => {
  if (Node.isIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralText();
  return undefined;
};

/** The object a factory answers with: an arrow's body, or its first `return`. */
const answerOf = (factory: TsNode | undefined): TsNode | undefined => {
  const fn = valueOf(factory);
  if (fn === undefined || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn))) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return valueOf(body);
  return valueOf(body.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression());
};

/** Every leaf of an object a factory answers with that reads as a port, by its dotted key. */
const walk = (object: TsNode | undefined, prefix: readonly string[], into: Map<string, WrittenPort>, depth = 0): void => {
  if (object === undefined || depth > MAX_DEPTH || !Node.isObjectLiteralExpression(object)) return;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const key = keyOf(property.getNameNode());
    const value = valueOf(property.getInitializer());
    if (key === undefined || value === undefined) continue;
    if (Node.isObjectLiteralExpression(value)) {
      walk(value, [...prefix, key], into, depth + 1);
      continue;
    }
    const read = portWritten(value);
    if (read.port !== undefined || read.setting !== undefined) into.set([...prefix, key].join('.'), read);
  }
};

/** The name a call is made by, its last part: `registerAs`, `ConfigModule.forRoot`'s `forRoot`. */
const calleeName = (call: CallExpression): string => {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : '';
};

/**
 * Every dotted key NestJS's settings factories in some files build that reads
 * as a port: `registerAs('app', factory)` under `app.`, and a factory handed
 * to `ConfigModule.forRoot({ load: [...] })` under no prefix.
 */
export const factoryPorts = (sources: Iterable<SourceFile>): Map<string, WrittenPort> => {
  const out = new Map<string, WrittenPort>();
  for (const file of sources) {
    const text = file.getFullText();
    if (!text.includes('registerAs') && !text.includes('ConfigModule')) continue;
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = calleeName(call);
      if (name === 'registerAs') {
        const [namespace, factory] = call.getArguments();
        const prefix = namespace === undefined ? undefined : keyOf(namespace);
        if (prefix !== undefined) walk(answerOf(factory), prefix.split('.'), out);
        continue;
      }
      if (name !== 'forRoot' || !call.getExpression().getText().endsWith('ConfigModule.forRoot')) continue;
      const options = valueOf(call.getArguments()[0]);
      const load = options !== undefined && Node.isObjectLiteralExpression(options) ? options.getProperty('load') : undefined;
      const list = load !== undefined && Node.isPropertyAssignment(load) ? valueOf(load.getInitializer()) : undefined;
      if (list === undefined || !Node.isArrayLiteralExpression(list)) continue;
      for (const element of list.getElements()) {
        // A namespaced factory is read where it is registered, above.
        const factory = valueOf(element);
        if (factory !== undefined && Node.isCallExpression(factory) && calleeName(factory) === 'registerAs') continue;
        walk(answerOf(element), [], out);
      }
    }
  }
  return out;
};

/** A literal of a schema entry: `default: 3005`, `env: 'PORT'`. */
const entryText = (object: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? valueOf(property.getInitializer()) : undefined;
};

/**
 * What a convict schema says a key is: `config.get('server.port')` of a
 * `convict({ server: { port: { default: 3005, env: 'PORT' } } })` is 3005
 * unless `PORT` is given.
 */
const convictAt = (call: CallExpression, key: string): WrittenPort | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const made = valueOf(callee.getExpression());
  if (made === undefined || !Node.isCallExpression(made) || calleeName(made) !== 'convict') return undefined;
  let entry = valueOf(made.getArguments()[0]);
  for (const part of key.split('.')) {
    if (entry === undefined || !Node.isObjectLiteralExpression(entry)) return undefined;
    const property = entry.getProperty(part);
    entry = property !== undefined && Node.isPropertyAssignment(property) ? valueOf(property.getInitializer()) : undefined;
  }
  if (entry === undefined || !Node.isObjectLiteralExpression(entry)) return undefined;
  const fallback = portWritten(entryText(entry, 'default'));
  const env = entryText(entry, 'env');
  const setting = env !== undefined && Node.isStringLiteral(env) ? env.getLiteralValue() : undefined;
  if (fallback.port === undefined && setting === undefined) return undefined;
  return { ...(setting === undefined ? {} : { setting }), ...(fallback.port === undefined ? {} : { port: fallback.port }) };
};

/** What the repository's settings libraries answer for a port read through a getter. */
export const settingsReading = (ctx: ExtractContext): PortReading => {
  const sources = [...repoSources(ctx)].filter((file) => !isTestFile(normalizeFilePath(file.getFilePath(), ctx.repoDir)));
  const factories = factoryPorts(sources);
  return { settingOf: (call, key) => convictAt(call, key) ?? factories.get(key) };
};
