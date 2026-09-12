import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
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
}

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
      ...(fallback?.resolved === true ? { defaultValue: fallback.value } : {}),
    };
  }

  if (Node.isElementAccessExpression(node)) {
    const target = node.getExpression().getText();
    if (target === 'process.env' || target.endsWith('.env') || target === 'env') {
      return { key: node.getArgumentExpression()?.getText() ?? '?', source: 'process.env', dynamic: true };
    }
    return null;
  }

  if (Node.isPropertyAccessExpression(node)) {
    const target = node.getExpression().getText();
    const key = node.getName();
    if (target === 'process.env') return { key, source: 'process.env' };
    // A platform binding: an environment object whose properties are the keys.
    if ((target === 'env' || target.endsWith('.env')) && ENV_KEY.test(key)) {
      return { key, source: 'binding' };
    }
    return null;
  }

  return null;
};
