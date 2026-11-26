import { isServiceSource } from '@flowatlas/core';
import type { PassContext } from '@flowatlas/extract-scopes';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { isResolved, resolveChannelName } from './channel-name.js';
import type { FeedCall, FeedLookup } from './hub-feeders.js';

/** The name a call is made by: the method's, or the function's. */
const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return Node.isIdentifier(callee) ? callee.getText() : undefined;
};

/**
 * How a walk out from a transport asks one repository about calls (P362):
 * every call of a function, by name and then by the checker; every call
 * through a record of handlers a function is a member of; a channel read as
 * the broker reader reads a producer's; a function's name.
 */
export const feedLookupFor = (ctx: PassContext): FeedLookup => {
  /** Every call in the repository by the name it is made with, built the first time a hub's feeders are followed. */
  let callsByName: Map<string, CallExpression[]> | undefined;
  /** Calls through a member of a value, by the name of the value: `this.handlers[t](…)` and `handlers.hub(…)` under `handlers`. */
  let callsByHolder: Map<string, CallExpression[]> | undefined;
  const indexCalls = (): void => {
    if (callsByName !== undefined) return;
    callsByName = new Map();
    callsByHolder = new Map();
    const into = (index: Map<string, CallExpression[]>, key: string, call: CallExpression): void => {
      const list = index.get(key);
      if (list === undefined) index.set(key, [call]);
      else list.push(call);
    };
    for (const source of ctx.project.getSourceFiles()) {
      if (!isServiceSource(source.getFilePath(), ctx.repoDir)) continue;
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const called = calledName(call);
        if (called !== undefined) into(callsByName, called, call);
        const callee = call.getExpression();
        if (Node.isPropertyAccessExpression(callee) || Node.isElementAccessExpression(callee)) {
          const holder = callee.getExpression();
          const name = Node.isPropertyAccessExpression(holder) ? holder.getName() : Node.isIdentifier(holder) ? holder.getText() : undefined;
          if (name !== undefined) into(callsByHolder, name, call);
        }
      }
    }
  };
  const callsNamed = (name: string): CallExpression[] => {
    indexCalls();
    return callsByName?.get(name) ?? [];
  };
  /**
   * The record of handlers a function is a member of, where it is one: an
   * object written out as a class's field or a constant (`handlers = { hub:
   * (channel, message) => … }`), the member's key, and the declaration holding it.
   */
  const recordMemberOf = (fn: TsNode): { holder: TsNode; holderName: string; member: string } | undefined => {
    const member = Node.isMethodDeclaration(fn) ? fn : fn.getParent();
    if (member === undefined || !(Node.isPropertyAssignment(member) || Node.isMethodDeclaration(member))) return undefined;
    let literal: TsNode | undefined = member.getParent();
    if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return undefined;
    while (literal.getParent() !== undefined && (Node.isAsExpression(literal.getParentOrThrow()) || Node.isSatisfiesExpression(literal.getParentOrThrow()) || Node.isParenthesizedExpression(literal.getParentOrThrow()))) {
      literal = literal.getParentOrThrow();
    }
    const holder = literal.getParent();
    if (holder === undefined || !(Node.isPropertyDeclaration(holder) || Node.isVariableDeclaration(holder)) || holder.getInitializer() !== literal) return undefined;
    const key = member.getNameNode();
    const name = Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key) ? key.getLiteralText() : Node.isIdentifier(key) ? key.getText() : undefined;
    return name === undefined ? undefined : { holder, holderName: holder.getName(), member: name };
  };
  /** The function a declaration the checker names holds: itself, or the function a name or a field is given. */
  const heldFunction = (declaration: TsNode): TsNode | undefined => {
    if (Node.isMethodDeclaration(declaration) || Node.isFunctionDeclaration(declaration)) return declaration;
    if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
      const value = declaration.getInitializer();
      return value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) ? value : undefined;
    }
    return undefined;
  };
  const functionName = (fn: TsNode): string => {
    const owner = fn.getFirstAncestor((at) => Node.isClassDeclaration(at));
    const record = recordMemberOf(fn);
    const own = record !== undefined ? `${record.holderName}.${record.member}` : Node.isMethodDeclaration(fn) || Node.isFunctionDeclaration(fn) ? fn.getName() : (fn.getParent() as { getName?: () => string } | undefined)?.getName?.();
    const name = own ?? '<anonymous>';
    return owner !== undefined && Node.isClassDeclaration(owner) ? `${owner.getName() ?? 'default'}.${name}` : name;
  };
  const feedLookup: FeedLookup = {
    callsOf: (fn) => {
      const record = recordMemberOf(fn);
      if (record !== undefined) {
        // `this.handlers[t](…)`, `this.handlers.hub(…)`, `handlers['hub'](…)`: through the value holding the record.
        indexCalls();
        const out: FeedCall[] = [];
        for (const call of callsByHolder?.get(record.holderName) ?? []) {
          const callee = call.getExpression();
          if (!Node.isPropertyAccessExpression(callee) && !Node.isElementAccessExpression(callee)) continue;
          const holder = callee.getExpression();
          const name = Node.isPropertyAccessExpression(holder) ? holder.getNameNode() : holder;
          if (name.getSymbol()?.getDeclarations()[0] !== record.holder) continue;
          if (Node.isPropertyAccessExpression(callee)) {
            if (callee.getName() === record.member) out.push({ call });
            continue;
          }
          out.push({ call, member: record.member });
        }
        return out;
      }
      const own = Node.isMethodDeclaration(fn) || Node.isFunctionDeclaration(fn) ? fn.getName() : (fn.getParent() as { getName?: () => string } | undefined)?.getName?.();
      if (own === undefined) return [];
      return callsNamed(own)
        .filter((call) => {
          const callee = call.getExpression();
          const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
          const symbol = name.getSymbol();
          const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
          return declaration !== undefined && heldFunction(declaration) === fn;
        })
        .map((call) => ({ call }));
    },
    named: (argument) => {
      const resolution = resolveChannelName(argument, ctx.config);
      return isResolved(resolution) ? resolution.names : undefined;
    },
    nameOf: functionName,
    fileOf: (node) => ctx.fileOf(node),
  };
  return feedLookup;
};
