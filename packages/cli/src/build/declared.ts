/**
 * The half of a build that reads a document instead of a repository.
 *
 * A project has ends it cannot read — a payment provider, another team's
 * service, something written in another language — and until now those were
 * counted as third party and the answer stopped there. A document declares
 * exactly what the join needs, so reading one gives the graph a second end
 * without teaching anything downstream that a second kind of end exists.
 *
 * Which format the document is written in is not decided here. The service says
 * its kind and the linker's lookup says which reader that is, so this file reads
 * a file and knows nothing else about it — the difference between an OpenAPI
 * document and an AsyncAPI one never reaches the build.
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
import { DocumentError, documentReader } from '@flowatlas/linker';

export interface DeclaredServiceOptions {
  service: ServiceConfig;
  /** Directory the configuration file is in; every configured path is under it. */
  rootDir: string;
  /** Fixed timestamp, for reproducible output. */
  builtAt?: string;
}

/** True for a service the configuration described rather than pointed at. */
export const isDeclared = (service: ServiceConfig): boolean => service.document !== undefined;

/** The document's path as a reader should see it: relative to the configuration. */
const documentPathOf = (service: ServiceConfig): string =>
  (service.document as { path: string }).path.replace(/\\/g, '/').replace(/^\.\//, '');

export interface DeclaredService {
  graph: RepoGraph;
  /** How many ends of the service the document declared. */
  declared: number;
  documentPath: string;
  /** Which format it was read as, for the line that names what read the service. */
  kind: string;
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
    throw new DocumentError(
      `${documentPath} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const { kind } = service.document as { kind: string };
  const { graph, declared } = documentReader(kind)(raw, {
    service: service.name,
    documentPath,
    ...(options.builtAt === undefined ? {} : { generatedAt: options.builtAt }),
  });

  return { graph, declared, documentPath, kind };
};
