import {
  lineOf,
  resolveClassOfExpression,
  resolveConstructorInjection,
  resolveFieldInjection,
} from '@flowatlas/core';
import type { ClassDeclaration, MethodDeclaration } from 'ts-morph';
import { angularDiOptions } from '../di.js';
import {
  componentDecorator,
  declarableDecorator,
  injectableDecorator,
  type AngularRole,
  type IndexedClass,
} from '../index-classes.js';
import { hostBindingsOf } from '../host.js';
import { arrayProperty, booleanProperty, metadataOf, stringProperty } from '../util/metadata.js';
import { definePass } from './types.js';

/** Roles the container instantiates, and therefore injects into. */
const MANAGED: ReadonlySet<AngularRole> = new Set(['component', 'directive', 'pipe', 'injectable']);

/** What a standalone component may import and the graph has a node for. */
const IMPORTABLE: ReadonlySet<AngularRole> = new Set(['component', 'directive', 'pipe', 'module']);

/**
 * Turns every class the container knows about into a node, and every injection
 * into an edge.
 *
 * Each injection point produces exactly one of two things: an `injects` edge, or
 * a row saying why it could not be followed. Nothing is dropped in between,
 * because a missing edge here is what makes a chain from a button end early.
 */
/** The node a method is drawn as, made when asked for. */
type MethodNode = (method: MethodDeclaration) => string | undefined;

/**
 * What a component or directive is exported to a template as, and what it binds
 * on its host element (P45), with the methods those bindings call as nodes
 * (`hostMembers`, P50). Nothing at all when it says neither.
 */
const boundBy = (
  declaration: ClassDeclaration,
  metadata: ReturnType<typeof metadataOf>,
  methodNode: MethodNode,
): Record<string, unknown> => {
  const exportAs = stringProperty(metadata, 'exportAs');
  const bindings = hostBindingsOf(declaration, metadata);
  const methods = bindings.flatMap((binding) => (binding.method === undefined ? [] : [binding.method]));
  const hostMembers = [...new Set(methods.flatMap((method) => methodNode(method) ?? []))];
  return {
    ...(exportAs === undefined ? {} : { exportAs }),
    ...(bindings.length === 0 ? {} : { hostBindings: bindings.map((binding) => binding.written) }),
    ...(hostMembers.length === 0 ? {} : { hostMembers }),
  };
};

/**
 * A directive by its selector, the name a template exports it as and what
 * it binds on its element (P40, P45); a pipe by the name a template writes
 * it as and whether it is pure, which it is unless it says otherwise.
 */
const DECLARABLE_META: Readonly<
  Record<
    'directive' | 'pipe',
    (declaration: ClassDeclaration, metadata: ReturnType<typeof metadataOf>, methodNode: MethodNode) => Record<string, unknown>
  >
> = {
  directive: (declaration, metadata, methodNode) => {
    const selector = stringProperty(metadata, 'selector');
    return { ...(selector === undefined ? {} : { selector }), ...boundBy(declaration, metadata, methodNode) };
  },
  pipe: (_declaration, metadata) => {
    const name = stringProperty(metadata, 'name');
    return { ...(name === undefined ? {} : { name }), pure: booleanProperty(metadata, 'pure') ?? true };
  },
};


export const classesPass = definePass('classes', (ctx) => {
  const options = angularDiOptions(ctx);
  const methodNode: MethodNode = (method) => ctx.ensureMethodNode(method)?.id;

  const component = (indexed: IndexedClass): void => {
    const metadata = metadataOf(componentDecorator(indexed.declaration));
    const selector = stringProperty(metadata, 'selector');
    const templateUrl = stringProperty(metadata, 'templateUrl');
    ctx.ensureClassNode(indexed.declaration, {
      ...(selector === undefined ? {} : { selector }),
      ...(templateUrl === undefined ? {} : { templateUrl }),
      ...boundBy(indexed.declaration, metadata, methodNode),
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

  const declarable = (indexed: IndexedClass, role: 'directive' | 'pipe'): void => {
    const metadata = metadataOf(declarableDecorator(indexed.declaration, role));
    const meta = DECLARABLE_META[role](indexed.declaration, metadata, methodNode);
    ctx.ensureClassNode(indexed.declaration, Object.keys(meta).length === 0 ? undefined : meta);
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
    if (indexed.role === 'directive' || indexed.role === 'pipe') declarable(indexed, indexed.role);
    if (MANAGED.has(indexed.role)) inject(indexed, indexed.declaration);
  }
});
