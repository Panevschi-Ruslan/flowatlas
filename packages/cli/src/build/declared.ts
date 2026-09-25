/**
 * The half of a build that reads a document instead of a repository.
 *
 * A project has ends it cannot read — a payment provider, another team's
 * service, something written in another language — and until now those were
 * counted as third party and the answer stopped there. An OpenAPI document
 * declares exactly what the join needs, so reading one gives the graph a second
 * end without teaching anything downstream that a second kind of end exists.
 *
 * What this does not do is ask how old the document is. It used to, and the
 * answer went into the graph, where both of its dates moved whenever anybody
 * committed and no snapshot could hold them. A graph records what does not
 * move; the age is a question about today and is asked where it is reported,
 * in `packages/cli/src/doctor/age.ts` (R78).
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { RepoGraph, ServiceConfig } from '@flowatlas/core';
import { OpenapiDocumentError, readOpenapiDocument } from '@flowatlas/linker';

export interface DeclaredServiceOptions {
  service: ServiceConfig;
  /** Directory the configuration file is in; every configured path is under it. */
  rootDir: string;
  /** Fixed timestamp, for reproducible output. */
  builtAt?: string;
}

/** True for a service the configuration described rather than pointed at. */
export const isDeclared = (service: ServiceConfig): boolean => service.openapi !== undefined;

/** The document's path as a reader should see it: relative to the configuration. */
const documentPathOf = (service: ServiceConfig): string =>
  (service.openapi as string).replace(/\\/g, '/').replace(/^\.\//, '');

export interface DeclaredService {
  graph: RepoGraph;
  /** How many routes the document declared. */
  routes: number;
  documentPath: string;
}

/**
 * One declared service, read.
 *
 * Read on every build rather than cached. A document is one file and parsing it
 * is nothing next to opening a type-checked program, and a cache keyed on file
 * hashes would be one more place for a stale answer to hide — on the one input
 * whose staleness this feature is most careful about.
 */
export const readDeclaredService = async (
  options: DeclaredServiceOptions,
): Promise<DeclaredService> => {
  const { service, rootDir } = options;
  const documentPath = documentPathOf(service);
  const absolute = isAbsolute(documentPath) ? documentPath : resolve(rootDir, documentPath);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (cause) {
    throw new OpenapiDocumentError(
      `${documentPath} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const { graph, routes } = readOpenapiDocument(raw, {
    service: service.name,
    documentPath,
    ...(options.builtAt === undefined ? {} : { generatedAt: options.builtAt }),
  });

  return { graph, routes, documentPath };
};
