import {
  lineOf,
  resolveClassOfExpression,
  resolveConstructorInjection,
  resolveFieldInjection,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import { angularDiOptions } from '../di.js';
import {
  componentDecorator,
  injectableDecorator,
  type AngularRole,
  type IndexedClass,
} from '../index-classes.js';
import { arrayProperty, metadataOf, stringProperty } from '../util/metadata.js';
import { definePass } from './types.js';

/** Roles the container instantiates, and therefore injects into. */
const MANAGED: ReadonlySet<AngularRole> = new Set(['component', 'injectable']);

/** What a standalone component may import and the graph has a node for. */
const IMPORTABLE: ReadonlySet<AngularRole> = new Set(['component', 'module']);

/**
 * Turns every class the container knows about into a node, and every injection
 * into an edge.
 *
 * Each injection point produces exactly one of two things: an `injects` edge, or
 * a row saying why it could not be followed. Nothing is dropped in between,
 * because a missing edge here is what makes a chain from a button end early.
 */
export const classesPass = definePass('classes', (ctx) => {
  const options = angularDiOptions(ctx);

  const component = (indexed: IndexedClass): void => {
    const metadata = metadataOf(componentDecorator(indexed.declaration));
    const selector = stringProperty(metadata, 'selector');
    const templateUrl = stringProperty(metadata, 'templateUrl');
    ctx.ensureClassNode(indexed.declaration, {
      ...(selector === undefined ? {} : { selector }),
      ...(templateUrl === undefined ? {} : { templateUrl }),
    });

    for (const element of arrayProperty(metadata, 'imports')) {
      const ref = resolveClassOfExpression(element);
      if (ref.kind !== 'local') continue;
      const target = ctx.classes.get(ref.declaration);
      if (target === undefined || !IMPORTABLE.has(target.role)) continue;
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
  };

  const injectable = (indexed: IndexedClass): void => {
    const metadata = metadataOf(injectableDecorator(indexed.declaration));
    const providedIn = stringProperty(metadata, 'providedIn');
    ctx.ensureClassNode(indexed.declaration, providedIn === undefined ? undefined : { providedIn });
  };

  const inject = (indexed: IndexedClass, declaration: ClassDeclaration): void => {
    const entries = [
      ...resolveConstructorInjection(declaration, options),
      ...resolveFieldInjection(declaration, options),
    ];
    if (entries.length > 0) ctx.ensureClassNode(declaration);

    for (const entry of entries) {
      ctx.di.set(declaration, entry);
      const { resolution } = entry;
      const at = entry.parameter ?? entry.declaration;
      const line = at === undefined ? indexed.line : lineOf(at);
      const where =
        entry.index === null
          ? `${indexed.name}.${entry.property ?? '?'}`
          : `${indexed.name}.constructor[${entry.index}]`;

      if (resolution.kind === 'unresolved') {
        ctx.report({
          file: indexed.file,
          line,
          reason: resolution.reason,
          ...(resolution.level === undefined ? {} : { level: resolution.level }),
          hint: resolution.hint,
          symbol: where,
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
        ...(entry.via === 'type' ? {} : { meta: { via: entry.via } }),
      });
    }
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'component') component(indexed);
    if (indexed.role === 'injectable') injectable(indexed);
    if (MANAGED.has(indexed.role)) inject(indexed, indexed.declaration);
  }
});
