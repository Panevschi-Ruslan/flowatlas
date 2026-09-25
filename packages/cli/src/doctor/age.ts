/**
 * How old a declared service's document is, asked at the moment it is reported.
 *
 * A service the configuration declared rather than pointed at is described by
 * an OpenAPI document somebody else wrote, and nothing here can check that
 * document against the service it claims to describe. How recently it was
 * updated is therefore the only evidence there is that it is still true, which
 * makes the age a deliverable rather than a detail: a stale document is a wrong
 * answer wearing a confident face.
 *
 * It used to be computed by the build and written into the graph, and that was
 * the wrong place for it. Both of its dates — the document's last commit and
 * the newest commit among the repositories that were read — move whenever
 * anybody commits, so a graph carrying them is a graph no byte-for-byte
 * snapshot can hold, and `fixtures/multi-repo-declared` went without one. The
 * most carefully argued feature in the tool was the one fixture whose graph
 * nothing compared (R78). The graph now records only what does not move, and
 * the age is worked out here, when `doctor` runs, from the same two places it
 * always came from.
 *
 * That makes one `doctor` run differ from another over one graph, which is a
 * real cost and is why it is confined to these rows. It is also the honest
 * answer: the question "is this document behind the service?" is about today,
 * not about the day the graph was built, and an answer cached at build time
 * gets more wrong the longer the graph sits.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Unresolved } from '@flowatlas/core';

/** The reason a row about a document's age carries. */
export const STALE_REASON = 'openapi-document-age';

/** One service the configuration described instead of pointing at. */
export interface DeclaredDocument {
  service: string;
  /** The document's path as the configuration writes it: relative, POSIX. */
  documentPath: string;
}

/**
 * The two dates the row is made of, behind an interface.
 *
 * Separating them from the sentence they end up in is what lets the sentence be
 * tested at all: a test that had to make a commit to ask what a stale document
 * says would be a test nobody trusts. The git-and-mtime implementation is below.
 */
export interface AgeReader {
  /** When the document itself last changed. */
  changedAt(documentPath: string): Date | undefined;
  /** The newest commit across the repositories that really were read. */
  newestCommit(): Date | undefined;
}

const day = (when: Date): string => when.toISOString().slice(0, 10);

/**
 * What `doctor` says about how old one document is.
 *
 * Always a row, and always at `info`. A document cannot be checked against the
 * service it describes — that is the whole reason this way in exists and the
 * one thing it must never pretend to do — so the honest thing is to put the
 * evidence in front of a reader rather than to raise an alarm on a threshold
 * somebody invented. `info` is this project's word for the tool describing its
 * own limits, which is exactly what this row is.
 */
const ageRow = (
  document: DeclaredDocument,
  changedAt: Date | undefined,
  newestCommit: Date | undefined,
): Unresolved => {
  const { service, documentPath } = document;
  const behind = changedAt !== undefined && newestCommit !== undefined && newestCommit > changedAt;
  const when =
    changedAt === undefined
      ? 'and nothing here could say when it last changed'
      : `last changed ${day(changedAt)}`;
  const against =
    newestCommit === undefined
      ? 'nothing here is a checkout, so there is no commit to compare it with'
      : `the newest commit among the repositories that were read is from ${day(newestCommit)}`;
  return {
    file: documentPath,
    line: 1,
    reason: STALE_REASON,
    level: 'info',
    service,
    symbol: service,
    message: `${service} was declared by ${documentPath}, ${when}; ${against}${behind ? ', so the document may be behind the service it describes' : ''}`,
    hint: behind
      ? `Fetch the current document from whoever owns ${service} and rebuild. Nothing here can check a document against the running service, so how recently it was updated is the only evidence there is that it is still true.`
      : `Nothing here can check a document against the running service. Every route and shape of ${service} in this graph is ${documentPath}'s word for it.`,
  };
};

/** One row per declared service, in the order the configuration lists them. */
export const documentAgeRows = (
  documents: readonly DeclaredDocument[],
  reader: AgeReader,
): Unresolved[] => {
  if (documents.length === 0) return [];
  // Asked once rather than once per document: it is the same question about the
  // same repositories, and it costs a process per directory to answer.
  const newest = reader.newestCommit();
  return documents.map((document) => ageRow(document, reader.changedAt(document.documentPath), newest));
};

/** The last commit date a `git log` line carries, or undefined when it says nothing. */
const commitDate = (dir: string, args: readonly string[]): Date | undefined => {
  try {
    const stdout = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cI', ...args], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const when = new Date(stdout.trim());
    return Number.isNaN(when.getTime()) ? undefined : when;
  } catch {
    return undefined;
  }
};

/**
 * The dates as a checkout on this machine gives them.
 *
 * The document's last commit is preferred over its modification time because
 * that is what "the document was updated" means to whoever maintains it: a
 * fetch that rewrites the file with identical bytes is not a change, and a
 * fresh clone gives every file the same modification time, which would say
 * every document in the project was updated today. The modification time is the
 * fallback for a document that is not committed, where it is the only evidence
 * there is.
 *
 * A directory that is not a checkout answers nothing rather than failing. A
 * fixture, a vendored copy and a tarball are all ordinary, and none of them is
 * a reason for the health check to refuse to run.
 */
export const gitAgeReader = (rootDir: string, readableDirs: readonly string[]): AgeReader => ({
  changedAt: (documentPath) => {
    const absolute = isAbsolute(documentPath) ? documentPath : resolve(rootDir, documentPath);
    const committed = commitDate(rootDir, ['--', absolute]);
    if (committed !== undefined) return committed;
    try {
      return new Date(statSync(absolute).mtimeMs);
    } catch {
      return undefined;
    }
  },
  newestCommit: () => {
    let newest: Date | undefined;
    for (const dir of readableDirs) {
      const when = commitDate(dir, []);
      if (when === undefined) continue;
      if (newest === undefined || when > newest) newest = when;
    }
    return newest;
  },
});
