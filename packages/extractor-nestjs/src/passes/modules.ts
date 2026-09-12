import type { Expression, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { ModuleInfo, ModuleKind, ProviderRegistration } from '../modules-index.js';
import { getDecorator, lineOf } from '@flowatlas/core';
import { NEST_COMMON } from '../index-classes.js';
import { isDynamicModuleExpression, resolveClassExpression } from '../util/resolve-class.js';
import { definePass } from './types.js';

const arrayProperty = (
  literal: ObjectLiteralExpression | undefined,
  name: string,
): Expression[] => {
  const property = literal?.getProperty(name);
  if (property === undefined || !Node.isPropertyAssignment(property)) return [];
  const initializer = property.getInitializer();
  if (initializer === undefined || !Node.isArrayLiteralExpression(initializer)) return [];
  return initializer.getElements();
};

const moduleOptions = (
  declaration: Parameters<typeof getDecorator>[0],
): ObjectLiteralExpression | undefined => {
  const decorator = getDecorator(declaration, 'Module', NEST_COMMON);
  const [argument] = decorator?.getArguments() ?? [];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

/** Token as written: a string literal keeps its value, anything else its text. */
const tokenOf = (expr: Expression): string =>
  Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)
    ? expr.getLiteralValue()
    : expr.getText();

const PROVIDER_SHAPES = ['useClass', 'useValue', 'useFactory', 'useExisting'] as const;

const readProvider = (
  expr: Expression,
  ctx: NestExtractContext,
): ProviderRegistration | undefined => {
  const file = ctx.fileOf(expr);
  const line = lineOf(expr);

  if (Node.isObjectLiteralExpression(expr)) {
    const provide = expr.getProperty('provide');
    if (provide === undefined || !Node.isPropertyAssignment(provide)) return undefined;
    const provideValue = provide.getInitializer();
    if (provideValue === undefined) return undefined;
    const token = tokenOf(provideValue);

    for (const shape of PROVIDER_SHAPES) {
      const property = expr.getProperty(shape);
      if (property === undefined || !Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (initializer === undefined) continue;
      if (shape === 'useExisting') {
        return { token, kind: shape, alias: tokenOf(initializer), file, line };
      }
      if (shape === 'useClass') {
        const target = resolveClassExpression(initializer);
        return {
          token,
          kind: shape,
          ...(target.kind === 'local' ? { declaration: target.declaration } : {}),
          file,
          line,
        };
      }
      return { token, kind: shape, file, line };
    }
    return { token, kind: 'useValue', file, line };
  }

  const target = resolveClassExpression(expr);
  if (target.kind === 'local') {
    return {
      token: target.declaration.getName() ?? expr.getText(),
      kind: 'class',
      declaration: target.declaration,
      file,
      line,
    };
  }
  if (target.kind === 'external') {
    return { token: target.typeName, kind: 'class', file, line };
  }
  return undefined;
};

/**
 * Reads every `@Module` and records what it declares.
 *
 * Membership is recorded as metadata on the members rather than as edges: the
 * data model has exactly one module edge, `imports`, and inventing a second one
 * would be a schema change made by accident.
 */
export const modulesPass = definePass('modules', (ctx) => {
  const parsed: ModuleInfo[] = [];

  for (const indexed of ctx.classes.withRole('module')) {
    const options = moduleOptions(indexed.declaration);
    const controllers = arrayProperty(options, 'controllers')
      .map((expr) => resolveClassExpression(expr))
      .flatMap((ref) => (ref.kind === 'local' ? [ref.declaration] : []));

    const providers = arrayProperty(options, 'providers')
      .map((expr) => readProvider(expr, ctx))
      .filter((provider): provider is ProviderRegistration => provider !== undefined);

    const exports = arrayProperty(options, 'exports').map((expr) => tokenOf(expr));

    const imports: ModuleInfo['imports'] = [];
    for (const expr of arrayProperty(options, 'imports')) {
      const dynamic = isDynamicModuleExpression(expr);
      const ref = resolveClassExpression(expr);
      if (ref.kind === 'unknown') {
        ctx.report({
          file: ctx.fileOf(expr),
          line: lineOf(expr),
          reason: 'module-import-dynamic',
          hint: 'Import a module class, or X.forRoot(...); a computed import cannot be followed.',
          symbol: `${indexed.name} imports ${ref.text}`,
        });
        continue;
      }
      if (ref.kind === 'external') {
        const node = ctx.ensureExternalClassNode({
          typeName: ref.typeName,
          package: ref.package,
          role: 'module',
        });
        imports.push({ id: node.id, kind: 'external', name: ref.typeName });
        continue;
      }
      const target = ctx.classes.get(ref.declaration);
      if (target === undefined) continue;
      imports.push({
        id: target.id,
        declaration: ref.declaration,
        kind: dynamic ? 'dynamic' : 'static',
        name: target.name,
      });
    }

    parsed.push({
      id: indexed.id,
      name: indexed.name,
      file: indexed.file,
      line: indexed.line,
      kind: 'static',
      declaration: indexed.declaration,
      controllers,
      providers,
      exports,
      imports,
    });
  }

  // Registered before any member node is created, so that each member picks up
  // its owning module in metadata as it is created.
  for (const info of parsed) ctx.modules.add(info);

  for (const info of parsed) {
    ctx.builder.addNode({
      id: info.id,
      type: 'module',
      label: info.name,
      repo: ctx.repo,
      file: info.file,
      line: info.line,
      kind: 'static',
      meta: {
        controllers: info.controllers
          .map((declaration) => ctx.classes.get(declaration)?.name)
          .filter((name): name is string => name !== undefined),
        providers: info.providers.map((provider) => provider.token),
        exports: info.exports,
      },
    });

    for (const imported of info.imports) {
      if (imported.declaration !== undefined) ctx.ensureClassNode(imported.declaration);
      const kind: ModuleKind = imported.kind;
      ctx.builder.addEdge({
        from: info.id,
        to: imported.id,
        type: 'imports',
        confidence: 'static',
        file: info.file,
        line: info.line,
        ...(kind === 'static' ? {} : { meta: { moduleKind: kind } }),
      });
    }
  }
});
