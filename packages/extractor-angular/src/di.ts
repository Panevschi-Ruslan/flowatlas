import {
  getDecorator,
  resolveClassOfExpression,
  type DiResolution,
  type DiResolverOptions,
} from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ParameterDeclaration, PropertyDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from './context.js';
import { ANGULAR_CORE } from './index-classes.js';

/** The call a property makes to ask the container for its own value. */
const injectCall = (property: PropertyDeclaration): CallExpression | undefined => {
  const initializer = property.getInitializer();
  if (initializer === undefined || !Node.isCallExpression(initializer)) return undefined;
  const callee = initializer.getExpression();
  return Node.isIdentifier(callee) && callee.getText() === 'inject' ? initializer : undefined;
};

/** What a token expression resolves to, whether written as a type or a value. */
const resolveToken = (
  ctx: AngularExtractContext,
  expr: TsNode,
  text: string,
): DiResolution => {
  const ref = resolveClassOfExpression(expr);
  if (ref.kind === 'local') {
    const id = ctx.classIdOf(ref.declaration);
    if (id !== undefined) return { kind: 'class', id, declaration: ref.declaration };
  }
  if (ref.kind === 'external') {
    return {
      kind: 'external',
      id: ctx.ensureExternalClassNode({ typeName: ref.typeName, package: ref.package }).id,
      package: ref.package,
      typeName: ref.typeName,
    };
  }
  return {
    kind: 'unresolved',
    reason: 'inject-token-unresolved',
    // Its own hint says this is expected, which is the definition of a row
    // nobody will act on.
    level: 'info',
    hint: 'The token is not a class, so there is nothing to point an edge at. Expected for an InjectionToken.',
    text,
  };
};

/**
 * The framework half of injection: what this container spells its annotations.
 *
 * Two shapes, both of which name a provider rather than a type: `@Inject(TOKEN)`
 * on a constructor parameter, and a field that calls `inject(Token)` for itself.
 * Everything else is the shared resolver's, which reads declared types and knows
 * nothing about either.
 */
export const angularDiOptions = (ctx: AngularExtractContext): DiResolverOptions => ({
  classIdOf: (declaration) => ctx.classIdOf(declaration),
  externalIdOf: (ref) =>
    ctx.ensureExternalClassNode({ typeName: ref.typeName, package: ref.package }).id,

  tokenResolver: (parameter: ParameterDeclaration) => {
    const decorator = getDecorator(parameter, 'Inject', ANGULAR_CORE);
    if (decorator === undefined) return undefined;
    const [argument] = decorator.getArguments();
    if (argument === undefined) return undefined;
    return resolveToken(ctx, argument, `@Inject(${argument.getText()})`);
  },

  fieldInjectResolver: (property: PropertyDeclaration) => {
    const call = injectCall(property);
    if (call === undefined) return undefined;
    const [token] = call.getArguments();
    if (token === undefined) return undefined;
    return resolveToken(ctx, token, call.getText());
  },

  isOptional: (parameter) => getDecorator(parameter, 'Optional', ANGULAR_CORE) !== undefined,
  injectHint: 'Inject a class, or name the provider with @Inject(TOKEN).',
});

export { injectCall };
