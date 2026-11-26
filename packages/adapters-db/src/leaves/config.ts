import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { takenMember } from '@flowatlas/core';
import { evaluateExpression } from '@flowatlas/extractor-nestjs';

/** How a configuration value was reached. */
export type ConfigSource = 'config.get' | 'process.env' | 'binding';

export interface ConfigRead {
  key: string;
  source: ConfigSource;
  /** Value used when the key is absent, when the call supplies one. */
  defaultValue?: unknown;
  /** True when the key itself could not be read. */
  dynamic?: boolean;
  /**
   * True when the read goes on without the value, whatever it is (P388): a
   * default not written out (`get('X', fallback)`), `process.env.X ?? y`,
   * `|| y`, the value only tested (`process.env.X ? a : b`, `if
   * (process.env.X)`). A read that is none of these needs the key set.
   */
  fallback?: true;
}

/** Whether a read is followed by what is used without it: `?? y`, `|| y`, a test of whether it is there. */
const goesOnWithout = (node: TsNode): boolean => {
  let at: TsNode = node;
  let parent = at.getParent();
  while (parent !== undefined && (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isNonNullExpression(parent))) {
    at = parent;
    parent = at.getParent();
  }
  if (parent === undefined) return false;
  if (Node.isBinaryExpression(parent) && parent.getLeft() === at) {
    const operator = parent.getOperatorToken().getKind();
    return operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken;
  }
  if (Node.isConditionalExpression(parent)) return parent.getCondition() === at;
  if (Node.isIfStatement(parent)) return parent.getExpression() === at;
  return false;
};

const CONFIG_PACKAGES = ['@nestjs/config'];

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

const isConfigReceiver = (receiver: TsNode): boolean => {
  const symbol = receiver.getType().getSymbol();
  const filePath = symbol?.getDeclarations()[0]?.getSourceFile().getFilePath() ?? '';
  if (CONFIG_PACKAGES.some((pkg) => filePath.includes(`/node_modules/${pkg}/`))) return true;
  // A settings object is often wrapped locally, so the name is a fallback.
  const text = receiver.getText().split('.').pop() ?? '';
  return /config(service)?$/i.test(text);
};

/**
 * Recognises a read of a configuration value.
 *
 * Three shapes reach the same thing: a settings service, the process
 * environment, and a platform binding. All three are worth recording, because
 * "why does this work locally and not on staging" is nearly always answered by
 * one of them.
 */
export const readConfig = (node: TsNode): ConfigRead | null => {
  // `const { ORDERS_URL = 'http://orders:3000' } = process.env`: the read is
  // spelled where the name is declared, and the name stands for it (P269).
  const taken = takenMember(node);
  if (taken !== undefined) {
    const target = taken.from.getText();
    const fallback = taken.fallback === undefined ? undefined : evaluateExpression(taken.fallback);
    const withDefault = fallback?.resolved === true ? { defaultValue: fallback.value } : taken.fallback !== undefined ? { fallback: true as const } : {};
    if (target === 'process.env') return { key: taken.key, source: 'process.env', ...withDefault };
    if ((target === 'env' || target.endsWith('.env')) && ENV_KEY.test(taken.key)) return { key: taken.key, source: 'binding', ...withDefault };
    return null;
  }
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return null;
    if (!['get', 'getOrThrow', 'require'].includes(callee.getName())) return null;
    if (!isConfigReceiver(callee.getExpression())) return null;
    const [keyArg, defaultArg] = node.getArguments();
    if (keyArg === undefined) return null;
    const key = evaluateExpression(keyArg);
    if (!key.resolved || typeof key.value !== 'string') {
      return { key: keyArg.getText(), source: 'config.get', dynamic: true };
    }
    const fallback = defaultArg === undefined ? undefined : evaluateExpression(defaultArg);
    return {
      key: key.value,
      source: 'config.get',
      ...(fallback?.resolved === true ? { defaultValue: fallback.value } : defaultArg !== undefined || goesOnWithout(node) ? { fallback: true as const } : {}),
    };
  }

  if (Node.isElementAccessExpression(node)) {
    const target = node.getExpression().getText();
    if (target === 'process.env' || target.endsWith('.env') || target === 'env') {
      // `process.env['JOB_VERBS']` names its key as plainly as `process.env.JOB_VERBS` (P401).
      const argument = node.getArgumentExpression();
      const key = argument === undefined ? undefined : evaluateExpression(argument);
      if (key?.resolved === true && typeof key.value === 'string' && (target === 'process.env' || ENV_KEY.test(key.value))) {
        return { key: key.value, source: target === 'process.env' ? 'process.env' : 'binding', ...(goesOnWithout(node) ? { fallback: true as const } : {}) };
      }
      return { key: argument?.getText() ?? '?', source: 'process.env', dynamic: true };
    }
    return null;
  }

  if (Node.isPropertyAccessExpression(node)) {
    const target = node.getExpression().getText();
    const key = node.getName();
    const without = goesOnWithout(node) ? { fallback: true as const } : {};
    if (target === 'process.env') return { key, source: 'process.env', ...without };
    // A platform binding: an environment object whose properties are the keys.
    if ((target === 'env' || target.endsWith('.env')) && ENV_KEY.test(key)) {
      return { key, source: 'binding', ...without };
    }
    return null;
  }

  return null;
};
