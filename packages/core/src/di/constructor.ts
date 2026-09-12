import type { ClassDeclaration, ParameterDeclaration } from 'ts-morph';
import { resolveClassOfType } from './class-ref.js';
import type { DiEntry, DiResolution, DiResolverOptions } from './types.js';

const DEFAULT_HINT = 'Inject a class this repository declares.';

const nameOf = (owner: ClassDeclaration): string => owner.getName() ?? '<anonymous>';

/**
 * Works out what a constructor parameter will be handed at run time, from its
 * declared type alone.
 *
 * The checker settles which class a type names, and an indexed class becomes an
 * edge. A type from an installed package is still an answer, since a call
 * through it is a leaf rather than a failure. Anything else is reported, because
 * a missing edge here is what makes a call chain end early three passes later.
 */
const resolveByType = (
  parameter: ParameterDeclaration,
  owner: ClassDeclaration,
  options: DiResolverOptions,
): DiResolution => {
  const typeNode = parameter.getTypeNode() ?? parameter;
  const ref = resolveClassOfType(typeNode);
  if (ref.kind === 'local') {
    const id = options.classIdOf(ref.declaration);
    if (id !== undefined) return { kind: 'class', id, declaration: ref.declaration };
  }
  if (ref.kind === 'external') {
    return {
      kind: 'external',
      id: options.externalIdOf(ref),
      package: ref.package,
      typeName: ref.typeName,
    };
  }
  const optional = parameter.hasQuestionToken() || options.isOptional?.(parameter) === true;
  return {
    kind: 'unresolved',
    reason: 'di-type-unresolved',
    hint: optional
      ? 'Optional parameter with no class type; nothing to point at.'
      : (options.injectHint ?? DEFAULT_HINT),
    text: `${nameOf(owner)}(${parameter.getText()})`,
  };
};

/**
 * Every constructor parameter of a class, resolved.
 *
 * An annotation naming a provider has the final say wherever the extractor reads
 * one, including when it fails: a parameter that names a token is not also a
 * parameter that names a type, and answering with the type would point the edge
 * at whatever the token happened to be declared as.
 */
export const resolveConstructorInjection = (
  cls: ClassDeclaration,
  options: DiResolverOptions,
): DiEntry[] => {
  const [constructor] = cls.getConstructors();
  if (constructor === undefined) return [];
  return constructor.getParameters().map((parameter, index) => {
    const byToken = options.tokenResolver?.(parameter);
    return {
      property: parameter.getName(),
      parameter,
      index,
      via: byToken === undefined ? 'type' : 'token',
      resolution: byToken ?? resolveByType(parameter, cls, options),
    };
  });
};

/**
 * Properties that ask the container for their own value.
 *
 * Only the extractor can tell one of those from an ordinary field, so without
 * `fieldInjectResolver` a class simply has none.
 */
export const resolveFieldInjection = (
  cls: ClassDeclaration,
  options: DiResolverOptions,
): DiEntry[] => {
  const resolve = options.fieldInjectResolver;
  if (resolve === undefined) return [];
  const entries: DiEntry[] = [];
  for (const property of cls.getProperties()) {
    const resolution = resolve(property);
    if (resolution === undefined) continue;
    entries.push({
      property: property.getName(),
      declaration: property,
      index: null,
      via: 'field-inject',
      resolution,
    });
  }
  return entries;
};
