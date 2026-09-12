import {
  getDecorator,
  makeSymbolId,
  type DiResolution,
  type DiResolverOptions,
  type TokenProviderKind,
} from '@flowatlas/core';
import type { ClassDeclaration, ParameterDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { ProviderRegistration } from '../modules-index.js';
import { NEST_COMMON } from '../index-classes.js';
import { unwrapClassExpression } from '../util/resolve-class.js';

const NEST_INJECT = ['@nestjs/common'] as const;

/** The token named by `@Inject(...)`, as written. */
const tokenOfInject = (parameter: ParameterDeclaration): string | undefined => {
  const decorator = getDecorator(parameter, 'Inject', NEST_INJECT);
  if (decorator === undefined) return undefined;
  const [argument] = decorator.getArguments();
  if (argument === undefined) return undefined;
  const expr = unwrapClassExpression(argument);
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.getLiteralValue();
  }
  return expr.getText();
};

/** Distinct classes backing a token, used to spot an ambiguous registration. */
const distinctClasses = (
  registrations: readonly ProviderRegistration[],
): ClassDeclaration[] => {
  const seen = new Set<ClassDeclaration>();
  for (const registration of registrations) {
    if (registration.declaration !== undefined) seen.add(registration.declaration);
  }
  return [...seen];
};

/**
 * What a token named by `@Inject(TOKEN)` will be handed at run time.
 *
 * The answer is in the module that registers the token, so the module index is
 * consulted, and an ambiguous or absent registration is reported rather than
 * guessed. An alias is followed a few hops, since a token provided by another
 * token is an ordinary way to swap an implementation.
 */
const resolveToken = (
  ctx: NestExtractContext,
  token: string,
  parameter: ParameterDeclaration,
): DiResolution => {
  const seen = new Set<string>();
  let current = token;
  for (let hop = 0; hop < 4; hop += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const registrations = ctx.modules.registrationsOf(current);
    if (registrations.length === 0) break;

    const existing = registrations.find((registration) => registration.kind === 'useExisting');
    if (existing?.alias !== undefined) {
      current = existing.alias;
      continue;
    }

    const classes = distinctClasses(registrations);
    if (classes.length > 1) {
      return {
        kind: 'unresolved',
        reason: 'di-token-ambiguous',
        hint: `Token ${current} is registered with ${classes.length} different classes; the one in effect depends on module order.`,
        text: `@Inject(${token})`,
      };
    }
    const [only] = classes;
    if (only !== undefined) {
      const indexed = ctx.classes.get(only);
      if (indexed !== undefined) {
        return { kind: 'class', id: indexed.id, declaration: only };
      }
    }

    const [first] = registrations;
    if (first !== undefined && (first.kind === 'useValue' || first.kind === 'useFactory')) {
      const provider: TokenProviderKind = first.kind;
      const id = makeSymbolId(ctx.repo, first.file, current);
      ctx.builder.addNode({
        id,
        type: 'provider',
        label: current,
        repo: ctx.repo,
        file: first.file,
        line: first.line,
        kind: provider === 'useValue' ? 'value' : 'factory',
        meta: { token: current },
      });
      return { kind: 'token', id, token: current, provider };
    }
    break;
  }

  return {
    kind: 'unresolved',
    reason: 'di-token-unknown',
    hint: `No module in this repository provides ${current}. Register it with { provide, useClass } or force the adapter that does.`,
    text: `@Inject(${token}) ${parameter.getName()}`,
  };
};

/**
 * The framework half of injection: what this container spells its annotations.
 *
 * Everything else — a parameter's declared type, the property it is stored
 * under, the map a call site is followed through — is the shared resolver's,
 * which is why this file has no walking in it.
 */
export const nestDiOptions = (ctx: NestExtractContext): DiResolverOptions => ({
  classIdOf: (declaration) => ctx.classes.get(declaration)?.id,
  externalIdOf: (ref) => ctx.ensureExternalClassNode({ typeName: ref.typeName, package: ref.package }).id,
  tokenResolver: (parameter) => {
    const token = tokenOfInject(parameter);
    return token === undefined ? undefined : resolveToken(ctx, token, parameter);
  },
  isOptional: (parameter) => getDecorator(parameter, 'Optional', NEST_COMMON) !== undefined,
  injectHint: 'Inject a class, or name the provider with @Inject(TOKEN).',
});

export const resolveInjectToken = tokenOfInject;
