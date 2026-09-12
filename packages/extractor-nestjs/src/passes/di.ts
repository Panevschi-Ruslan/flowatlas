import { lineOf, resolveConstructorInjection } from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import { nestDiOptions } from '../di/resolver.js';
import type { ClassRole } from '../index-classes.js';
import { definePass } from './types.js';

/** Roles the container instantiates, and therefore injects into. */
const MANAGED: ReadonlySet<ClassRole> = new Set([
  'controller',
  'injectable',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
]);

/**
 * Resolves every constructor parameter of every managed class.
 *
 * Each parameter produces exactly one of two things: an `injects` edge, or a row
 * saying why it could not be followed. Nothing is dropped in between, because a
 * missing edge here is what makes a call chain end early three passes later.
 */
export const diPass = definePass('di', (ctx) => {
  const options = nestDiOptions(ctx);
  const managed = new Set<ClassDeclaration>();

  for (const indexed of ctx.classes.all()) {
    if (MANAGED.has(indexed.role)) managed.add(indexed.declaration);
  }
  for (const info of ctx.modules.all()) {
    for (const provider of info.providers) {
      if (provider.declaration !== undefined) managed.add(provider.declaration);
    }
  }

  for (const declaration of managed) {
    const indexed = ctx.classes.get(declaration);
    if (indexed === undefined) continue;

    const entries = resolveConstructorInjection(declaration, options);
    if (entries.length > 0) ctx.ensureClassNode(declaration);

    for (const entry of entries) {
      ctx.di.set(declaration, entry);
      const { resolution, parameter } = entry;
      const line = parameter === undefined ? indexed.line : lineOf(parameter);

      if (resolution.kind === 'unresolved') {
        ctx.report({
          file: indexed.file,
          line,
          reason: resolution.reason,
          ...(resolution.level === undefined ? {} : { level: resolution.level }),
          hint: resolution.hint,
          symbol: `${indexed.name}.constructor[${entry.index}]`,
        });
        continue;
      }

      if (resolution.kind === 'class') ctx.ensureClassNode(resolution.declaration);

      ctx.builder.addEdge({
        from: indexed.id,
        to: resolution.id,
        type: 'injects',
        confidence: 'static',
        file: indexed.file,
        line,
        ...(resolution.kind === 'token'
          ? { meta: { token: resolution.token, provider: resolution.provider } }
          : {}),
      });
    }
  }
});
