import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { functionsOf, methodsOf } from './types-pass.js';
import { definePass } from './types.js';

/** One line a step writes to its log: the level, the words, and where. */
export interface LogLine {
  level: string;
  /** The message as written, every interpolated value replaced by `{name}`. */
  text?: string;
  at: number;
}

/**
 * The method names that write a line, by the level each one writes at.
 *
 * A `Map` so that a name read from source is never asked of an object literal
 * (R130). The framework's own logger, the console and the common structured
 * loggers share these names, which is what lets one table read all of them.
 */
const LOG_LEVELS: ReadonlyMap<string, string> = new Map([
  ['log', 'log'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
  ['verbose', 'verbose'],
  ['trace', 'trace'],
  ['fatal', 'fatal'],
]);

/** The last name of an expression: `this.logger` is `logger`, `Logger` is `Logger`. */
const lastName = (node: TsNode): string | undefined => {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (Node.isThisExpression(node)) return undefined;
  return undefined;
};

/** Whether a receiver is a logger by its name: the console, or anything called a logger. */
const isLoggerName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower === 'console' || lower === 'log' || lower.endsWith('logger');
};

/** A value in a message, named by what holds it and never by what it holds. */
const placeholder = (node: TsNode): string => {
  const name = lastName(node);
  return name === undefined ? '{}' : `{${name}}`;
};

/**
 * The words of a message with its values taken out.
 *
 * A literal is its own text. An interpolation or a concatenation keeps the
 * written parts and puts a named hole where each value goes, so the template
 * reaches the graph and no value ever does. Anything else is not a template.
 */
const templateOf = (node: TsNode): string | undefined => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isTemplateExpression(node)) {
    const parts = [node.getHead().getLiteralText()];
    for (const span of node.getTemplateSpans()) {
      parts.push(placeholder(span.getExpression()), span.getLiteral().getLiteralText());
    }
    return parts.join('');
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '+') {
    const left = templateOf(node.getLeft()) ?? placeholder(node.getLeft());
    const right = templateOf(node.getRight()) ?? placeholder(node.getRight());
    return left + right;
  }
  if (Node.isParenthesizedExpression(node)) return templateOf(node.getExpression());
  return undefined;
};

/**
 * The message of a call, wherever the logger expects it.
 *
 * First in the ordinary spelling; second where a structured logger takes the
 * fields first and the words after them (`logger.info({ id }, 'sent')`).
 */
const messageOf = (args: readonly TsNode[]): string | undefined => {
  const [first, second] = args;
  if (first === undefined) return undefined;
  const text = templateOf(first);
  if (text !== undefined) return text;
  if (Node.isObjectLiteralExpression(first) && second !== undefined) return templateOf(second);
  return undefined;
};

/** The line a call writes, when the call is a logger's. */
export const logLineOf = (call: CallExpression): LogLine | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const level = LOG_LEVELS.get(callee.getName());
  if (level === undefined) return undefined;
  const receiver = lastName(callee.getExpression());
  if (receiver === undefined || !isLoggerName(receiver)) return undefined;
  const text = messageOf(call.getArguments());
  return { level, ...(text === undefined ? {} : { text }), at: call.getStartLineNumber() };
};

/** Every line a body writes, in source order; a class written inside it is its own. */
export const logLinesIn = (body: TsNode): LogLine[] => {
  const lines: LogLine[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const line = logLineOf(node);
    if (line !== undefined) lines.push(line);
  });
  return lines;
};

/**
 * Records on each step the lines it writes to its log (P71).
 *
 * What a step logs is how its run is recognised in a log stream, so it is
 * written as the template, never the values: `logs: [{ level, text, at }]`.
 */
export const logsPass = definePass('logs', (ctx: NestExtractContext) => {
  for (const [id, declaration] of [...methodsOf(ctx), ...functionsOf(ctx)]) {
    const node = ctx.builder.getNode(id);
    if (node === undefined || node.meta?.['logs'] !== undefined) continue;
    const lines = logLinesIn(declaration);
    if (lines.length > 0) node.meta = { ...node.meta, logs: lines };
  }
});
