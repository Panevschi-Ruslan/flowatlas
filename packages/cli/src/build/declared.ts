/**
 * The half of a build that reads a document instead of a repository.
 *
 * A project has ends it cannot read — a payment provider, another team's
 * service, something written in another language — and until now those were
 * counted as third party and the answer stopped there. An OpenAPI document
 * declares exactly what the join needs, so reading one gives the graph a second
 * end without teaching anything downstream that a second kind of end exists.
 *
 * Two things are kept separate here on purpose. Reading the document is the
 * linker's job and has no idea what a commit is; asking how old the document is
 * belongs to the build, because only the build knows which repositories it read
 * and where they are. They meet in one row on the graph, which is how `doctor`
 * comes to say it.
 */
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RepoGraph, ServiceConfig, Unresolved } from '@flowatlas/core';
import { OpenapiDocumentError, readOpenapiDocument } from '@flowatlas/linker';

const run = promisify(execFile);

/** The reason a row about a document's age carries. */
export const STALE_REASON = 'openapi-document-age';

export interface DeclaredServiceOptions {
  service: ServiceConfig;
  /** Directory the configuration file is in; every configured path is under it. */
  rootDir: string;
  /** Fixed timestamp, for reproducible output. */
  builtAt?: string;
  /** When the newest commit of everything that *was* read landed, if known. */
  newestCommit?: Date;
}

/** True for a service the configuration described rather than pointed at. */
export const isDeclared = (service: ServiceConfig): boolean => service.openapi !== undefined;

/** The document's path as a reader should see it: relative to the configuration. */
const documentPathOf = (service: ServiceConfig): string =>
  (service.openapi as string).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * When the document itself last changed.
 *
 * The commit that last touched it, when it is in a checkout, because that is
 * what "the document was updated" means to whoever maintains it — a fetch that
 * rewrites the file with identical bytes is not a change, and a fresh clone
 * gives every file the same modification time, which would say every document
 * in the project was updated today. The modification time is the fallback for a
 * document that is not committed, where it is the only evidence there is.
 */
const documentChangedAt = async (dir: string, path: string, fallback: Date): Promise<Date> => {
  try {
    const { stdout } = await run('git', ['-C', dir, 'log', '-1', '--format=%cI', '--', path], {
      timeout: 5_000,
    });
    const when = new Date(stdout.trim());
    return Number.isNaN(when.getTime()) ? fallback : when;
  } catch {
    return fallback;
  }
};

/**
 * The newest commit across the repositories this build actually read.
 *
 * The question a stale document raises is whether the work has moved on since
 * somebody last fetched it, and the work is in the repositories that are here.
 * A directory that is not a checkout answers nothing rather than failing: a
 * fixture, a vendored copy and a tarball are all ordinary, and none of them is
 * a reason to refuse to build.
 */
export const newestCommitAcross = async (dirs: readonly string[]): Promise<Date | undefined> => {
  let newest: Date | undefined;
  for (const dir of dirs) {
    try {
      const { stdout } = await run('git', ['-C', dir, 'log', '-1', '--format=%cI'], {
        timeout: 5_000,
      });
      const when = new Date(stdout.trim());
      if (Number.isNaN(when.getTime())) continue;
      if (newest === undefined || when > newest) newest = when;
    } catch {
      continue;
    }
  }
  return newest;
};

/**
 * What the graph says about how old the document is.
 *
 * Always a row, and always at `info`. A document cannot be checked against the
 * service it describes — that is the whole reason this way in exists and the
 * one thing it must never pretend to do — so its age is the only evidence there
 * is about whether to believe it, and the honest thing is to put that evidence
 * where a reader will see it rather than to raise an alarm on a threshold
 * somebody invented. `info` is this project's word for the tool describing its
 * own limits, which is exactly what this row is.
 */
const ageRow = (
  service: ServiceConfig,
  documentPath: string,
  changedAt: Date,
  newestCommit: Date | undefined,
): Unresolved => {
  const document = changedAt.toISOString().slice(0, 10);
  const behind = newestCommit !== undefined && newestCommit > changedAt;
  const against =
    newestCommit === undefined
      ? 'nothing here is a checkout, so there is no commit to compare it with'
      : `the newest commit among the repositories that were read is from ${newestCommit.toISOString().slice(0, 10)}`;
  return {
    file: documentPath,
    line: 1,
    reason: STALE_REASON,
    level: 'info',
    service: service.name,
    symbol: service.name,
    message: `${service.name} was declared by ${documentPath}, last changed ${document}; ${against}${behind ? ', so the document may be behind the service it describes' : ''}`,
    hint: behind
      ? `Fetch the current document from whoever owns ${service.name} and rebuild. Nothing here can check a document against the running service, so how recently it was updated is the only evidence there is that it is still true.`
      : `Nothing here can check a document against the running service. Every route and shape of ${service.name} in this graph is ${documentPath}'s word for it.`,
  };
};

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

  const changedAt = await documentChangedAt(rootDir, absolute, new Date(statSync(absolute).mtimeMs));
  graph.unresolved.push(ageRow(service, documentPath, changedAt, options.newestCommit));
  return { graph, routes, documentPath };
};
