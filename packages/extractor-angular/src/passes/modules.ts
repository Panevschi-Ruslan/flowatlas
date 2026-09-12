import { lineOf, resolveClassOfExpression } from '@flowatlas/core';
import { moduleDecorator } from '../index-classes.js';
import { collectRoutes } from '../routes.js';
import { arrayProperty, metadataOf } from '../util/metadata.js';
import { definePass } from './types.js';

/**
 * Reads the module graph and the routes.
 *
 * First, because everything after it depends on what a module said: a component
 * a module declares is not standalone, and a link in a template can only be
 * answered once the routes are known.
 */
export const modulesPass = definePass('modules', (ctx) => {
  for (const indexed of ctx.classes.withRole('module')) {
    const metadata = metadataOf(moduleDecorator(indexed.declaration));
    for (const element of arrayProperty(metadata, 'declarations')) {
      const ref = resolveClassOfExpression(element);
      if (ref.kind === 'local') ctx.modules.set(ref.declaration, indexed.name);
    }
  }

  for (const indexed of ctx.classes.withRole('module')) {
    const metadata = metadataOf(moduleDecorator(indexed.declaration));
    const providers = arrayProperty(metadata, 'providers')
      .map((element) => resolveClassOfExpression(element))
      .flatMap((ref) => (ref.kind === 'local' ? [ctx.classIdOf(ref.declaration) ?? ''] : []))
      .filter((id) => id !== '')
      .sort();

    ctx.ensureClassNode(indexed.declaration, providers.length === 0 ? undefined : { providers });

    for (const element of arrayProperty(metadata, 'imports')) {
      const ref = resolveClassOfExpression(element);
      if (ref.kind !== 'local') continue;
      const target = ctx.classes.get(ref.declaration);
      // A module imports modules; anything else in the list is a standalone
      // component or a directive, which changes what a template can use and
      // nothing about which code reaches which.
      if (target === undefined || target.role !== 'module') continue;
      ctx.ensureClassNode(ref.declaration);
      ctx.builder.addEdge({
        from: indexed.id,
        to: target.id,
        type: 'imports',
        confidence: 'static',
        file: indexed.file,
        line: lineOf(element),
      });
    }
  }

  ctx.routes.push(...collectRoutes(ctx));
});
