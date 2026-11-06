import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ts } from 'ts-morph';

/**
 * A framework's configuration file, read as far as it is written in literals
 * (P240), and the names a module exports, read off its syntax.
 *
 * A configuration file is code, and running it is not something this tool
 * does. Most of what a reader needs from one is written as a literal anyway:
 * a directory, a list of modules, a table of aliases. So the file is parsed,
 * never evaluated, and its default export is turned into plain values where
 * it is plain: an object, an array, a string, a number, a boolean. A path
 * built the way Node code builds one from the file's own directory -
 * `fileURLToPath(new URL('./src', import.meta.url))`, `resolve(__dirname,
 * 'src')` - is a {@link ConfigPath}. Anything else is a {@link NotLiteral},
 * which keeps its text, so a reader can say which setting it could not read
 * rather than reading a default in its place without a word.
 */

/** A path the configuration builds from its own directory, made absolute. */
export class ConfigPath {
  constructor(readonly path: string) {}
}

/** A value written as code rather than as a literal: its text, for the row that says so. */
export class NotLiteral {
  constructor(readonly text: string) {}
}

/** A configuration's default export, and where it is. */
export interface ConfigLiteral {
  /** Absolute path of the file read. */
  readonly file: string;
  /** The default export as plain values, {@link ConfigPath} and {@link NotLiteral} where they are. */
  readonly value: unknown;
}

const scriptKindOf = (file: string): ts.ScriptKind =>
  /\.[cm]?tsx$/.test(file) || file.endsWith('.jsx') ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/** A syntax tree of a file's text: no program, no checker, nothing resolved. */
export const parseSyntax = (text: string, file: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));

/** The expression under any number of parentheses, `as` and `satisfies`. */
const unwrap = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isTypeAssertionExpression(at)) {
    at = at.expression;
  }
  return at;
};

/** The initializer of a top-level `const name = ...` of the file. */
const constNamed = (file: ts.SourceFile, name: string): ts.Expression | undefined => {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
  }
  return undefined;
};

/**
 * What a configuration exports as its value: the object handed to a
 * `define...Config(...)` call, returned by a function of the mode, or named
 * by a `const`.
 */
const configExpression = (file: ts.SourceFile, at: ts.Expression | undefined, depth = 0): ts.Expression | undefined => {
  if (at === undefined || depth > 4) return undefined;
  const value = unwrap(at);
  if (ts.isIdentifier(value)) return configExpression(file, constNamed(file, value.text), depth + 1);
  if (ts.isCallExpression(value) && value.arguments.length > 0) return configExpression(file, value.arguments[0], depth + 1);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    if (!ts.isBlock(value.body)) return configExpression(file, value.body, depth + 1);
    const returned = value.body.statements.find(ts.isReturnStatement);
    return configExpression(file, returned?.expression, depth + 1);
  }
  return value;
};

/** The default export's expression: `export default x`, or `module.exports = x`. */
const defaultExportOf = (file: ts.SourceFile): ts.Expression | undefined => {
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) return statement.expression;
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(file) === 'module.exports'
    ) {
      return statement.expression.right;
    }
  }
  return undefined;
};

const literalText = (node: ts.Expression): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

/** Names a configuration file's own directory: `__dirname`, `import.meta.dirname`, `process.cwd()`. */
const isOwnDirectory = (node: ts.Expression, file: ts.SourceFile): boolean => {
  const text = unwrap(node).getText(file);
  return text === '__dirname' || text === 'import.meta.dirname' || text === 'process.cwd()';
};

/** The callee's last name: `resolve`, `path.resolve` and `join` alike. */
const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

/** A path built from the file's own directory, absolute, or undefined when it is not one. */
const pathOf = (node: ts.Expression, file: ts.SourceFile, dir: string): string | undefined => {
  const value = unwrap(node);
  if (ts.isNewExpression(value) && value.expression.getText(file) === 'URL') {
    const [first, base] = value.arguments ?? [];
    const relative = first === undefined ? undefined : literalText(unwrap(first));
    if (relative !== undefined && base !== undefined && unwrap(base).getText(file) === 'import.meta.url') return resolve(dir, relative);
    return undefined;
  }
  if (!ts.isCallExpression(value)) return undefined;
  const name = calleeName(value);
  if (name === 'fileURLToPath' && value.arguments.length === 1) return pathOf(value.arguments[0] as ts.Expression, file, dir);
  if (name !== 'resolve' && name !== 'join') return undefined;
  const [head, ...rest] = value.arguments;
  if (head === undefined || !isOwnDirectory(head, file)) return undefined;
  const parts = rest.map((part) => literalText(unwrap(part)));
  if (parts.some((part) => part === undefined)) return undefined;
  return name === 'resolve' ? resolve(dir, ...(parts as string[])) : join(dir, ...(parts as string[]));
};

/** One expression as plain values. */
const valueOf = (node: ts.Expression, file: ts.SourceFile, dir: string, depth = 0): unknown => {
  const value = unwrap(node);
  const text = literalText(value);
  if (text !== undefined) return text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (depth < 12 && ts.isArrayLiteralExpression(value)) {
    return value.elements.map((element) => (ts.isSpreadElement(element) ? new NotLiteral(element.getText(file)) : valueOf(element, file, dir, depth + 1)));
  }
  if (depth < 12 && ts.isObjectLiteralExpression(value)) {
    const out: Record<string, unknown> = {};
    for (const property of value.properties) {
      const key = property.name === undefined ? undefined : ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : undefined;
      if (key === undefined) continue;
      if (ts.isPropertyAssignment(property)) out[key] = valueOf(property.initializer, file, dir, depth + 1);
      else out[key] = new NotLiteral(property.getText(file));
    }
    return out;
  }
  const path = pathOf(value, file, dir);
  return path === undefined ? new NotLiteral(value.getText(file)) : new ConfigPath(path);
};

/**
 * The first of `names` in `dir` that is there, read as a configuration, or
 * undefined when none is there. A file that does not parse into an exported
 * value reads as a value that is {@link NotLiteral}.
 */
export const readConfigLiteral = (dir: string, names: readonly string[]): ConfigLiteral | undefined => {
  const found = names.map((name) => join(dir, name)).find((path) => existsSync(path));
  if (found === undefined) return undefined;
  let text: string;
  try {
    text = readFileSync(found, 'utf8');
  } catch {
    return undefined;
  }
  const file = parseSyntax(text, found);
  const expression = configExpression(file, defaultExportOf(file));
  return {
    file: found,
    value: expression === undefined ? new NotLiteral('') : valueOf(expression, file, dirname(found)),
  };
};

/** The value at a dotted key of a configuration's value, or undefined where nothing is written. */
export const configValueAt = (value: unknown, key: string): unknown => {
  let at = value;
  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null || at instanceof NotLiteral || at instanceof ConfigPath || Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
};

/** What a module exports as values, read off its syntax: named exports, and whether it has a default. */
export interface ExportedNames {
  readonly named: readonly string[];
  readonly hasDefault: boolean;
}

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const hasDefaultModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);

/** The names a binding declares: `a`, and every name inside `{ a, b: [c] }`. */
export const bindingNames = (name: ts.BindingName): string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
};

/**
 * The values a module's text exports, by name. Types are left out: what this
 * is asked for is what a call can name. A star re-export is not followed,
 * because what it gives is another file's answer.
 */
export const exportedNamesOf = (text: string, fileName: string): ExportedNames => {
  const file = parseSyntax(text, fileName);
  const named: string[] = [];
  let hasDefault = false;
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals !== true) hasDefault = true;
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        if (element.name.text === 'default') hasDefault = true;
        else named.push(element.name.text);
      }
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (hasDefaultModifier(statement)) {
      hasDefault = true;
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) named.push(...bindingNames(declaration.name));
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined) {
      named.push(statement.name.text);
    }
  }
  return { named: [...new Set(named)], hasDefault };
};
