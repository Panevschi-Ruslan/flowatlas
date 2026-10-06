import type { InfraModuleConfig } from '@flowatlas/core';

/** A source in this repository: `./modules/x`, `../shared`. */
export const isLocalSource = (source: string): boolean => source.startsWith('./') || source.startsWith('../');

/**
 * A source as two spellings of one module would both write it.
 *
 * The version a source pins (`?ref=v2.1.0`) says which release and not which
 * module, so it is dropped; so is the `git::` that forces a protocol and the
 * registry host a registry address may or may not spell out.
 */
export const normaliseSource = (source: string): string =>
  source
    .trim()
    .replace(/^git::/, '')
    .replace(/^registry\.terraform\.io\//, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');

const asPattern = (pattern: string): RegExp =>
  new RegExp(`^${normaliseSource(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** The description of a module, by its source; the first that matches wins. */
export const describedModule = (
  source: string,
  descriptions: readonly InfraModuleConfig[],
): InfraModuleConfig | undefined => {
  const written = normaliseSource(source);
  return descriptions.find((description) =>
    (Array.isArray(description.source) ? description.source : [description.source]).some((pattern) =>
      asPattern(pattern).test(written),
    ),
  );
};
