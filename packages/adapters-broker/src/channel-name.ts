import { packageNameOf, type FlowatlasConfig } from '@flowatlas/core';
import { evaluateExpression, stableKey } from '@flowatlas/extractor-nestjs';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/** How a channel name was arrived at. */
export type ChannelVia = 'literal' | 'const' | 'enum' | 'shared-package' | 'pattern' | 'template';

export interface ResolvedChannel {
  readonly name: string;
  readonly via: ChannelVia;
}

export interface UnresolvedChannel {
  readonly unresolved: 'channel-from-config' | 'channel-dynamic' | 'channel-const-unresolved';
  readonly text: string;
}

export type ChannelResolution = ResolvedChannel | UnresolvedChannel;

const CONFIG_METHODS = new Set(['get', 'getOrThrow', 'require']);

/** A read of a settings value, which is a name only known once the app runs. */
const isConfigRead = (node: TsNode): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (!CONFIG_METHODS.has(callee.getName())) return false;
  const receiver = callee.getExpression().getText().split('.').pop() ?? '';
  return /config(service)?$/i.test(receiver) || /env$/i.test(receiver);
};

const declarationOf = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return undefined;
  const symbol = node.getSymbol();
  if (symbol === undefined) return undefined;
  return (symbol.getAliasedSymbol() ?? symbol).getDeclarations()[0];
};

/** Which shared package a declaration came from, when it came from one. */
const sharedPackageOf = (
  declaration: TsNode | undefined,
  sharedPackages: readonly string[],
): string | undefined => {
  if (declaration === undefined) return undefined;
  const path = declaration.getSourceFile().getFilePath();
  // The manifest is the reliable answer, because a workspace reaches its own
  // packages through a link. The path is the fallback for anything installed
  // the ordinary way, where no manifest is reachable.
  const owner = packageNameOf(path);
  return (
    sharedPackages.find((pkg) => pkg === owner) ??
    sharedPackages.find((pkg) => path.includes(`/node_modules/${pkg}/`))
  );
};

/**
 * Works out which channel a call is addressed to.
 *
 * In order: a literal, then a constant or enum member the checker can follow
 * (including into a package the project shares between services), then a
 * settings lookup, then anything else. Only the first two produce a channel
 * node; the rest produce a producer with no channel and a row saying which
 * annotation would fix it. A guessed channel name would silently join two
 * services that never talk to each other.
 */
export const resolveChannelName = (
  expr: TsNode,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
): ChannelResolution => {
  const text = expr.getText();

  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return { name: expr.getLiteralValue(), via: 'literal' };
  }

  if (isConfigRead(expr)) return { unresolved: 'channel-from-config', text };

  // A channel addressed per entity is written as a template. The family it
  // belongs to is fixed even though the instance is not, and the family is what
  // a producer in one service and a handler in another have in common.
  if (Node.isTemplateExpression(expr)) {
    const head = expr.getHead().getLiteralText();
    const rest = expr
      .getTemplateSpans()
      .map((span) => {
        const value = evaluateExpression(span.getExpression());
        const piece = value.resolved && typeof value.value === 'string' ? value.value : '*';
        return piece + span.getLiteral().getLiteralText();
      })
      .join('');
    const name = head + rest;
    // Nothing but holes names nothing.
    if (name.replace(/[*]/g, '').trim() === '') return { unresolved: 'channel-dynamic', text };
    return { name, via: name.includes('*') ? 'template' : 'literal' };
  }

  const value = evaluateExpression(expr);
  if (value.resolved) {
    if (typeof value.value === 'string') {
      const declaration = declarationOf(expr);
      const shared = sharedPackageOf(declaration, config.sharedPackages);
      if (shared !== undefined) return { name: value.value, via: 'shared-package' };
      if (declaration !== undefined && Node.isEnumMember(declaration)) {
        return { name: value.value, via: 'enum' };
      }
      return { name: value.value, via: 'const' };
    }
    if (typeof value.value === 'object' && value.value !== null) {
      // An object pattern addresses a channel too; its stable text is the name.
      return { name: stableKey(value.value), via: 'pattern' };
    }
  }

  // An identifier that names something the checker could not follow is worth
  // telling apart from an expression that was never going to be constant.
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    return { unresolved: 'channel-const-unresolved', text };
  }
  return { unresolved: 'channel-dynamic', text };
};

export const isResolved = (resolution: ChannelResolution): resolution is ResolvedChannel =>
  'name' in resolution;
