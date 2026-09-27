/**
 * What every reader of a document has in common, which is nearly everything.
 *
 * A document is somebody else's statement about a service nothing here can
 * open, and that is true of it whatever format it is written in: the output is
 * an ordinary `RepoGraph`, every fact in it is labelled with the file it came
 * from, and a document that cannot be read at all is a configuration mistake
 * rather than a finding. Those three decisions were argued once, for OpenAPI
 * (P19), and none of them is about routes; a second format that restated any of
 * them would be a second answer to a question already settled.
 *
 * What is *not* here is how a document spells what it describes. That differs,
 * and it is the only thing that does.
 */
import type { RepoGraph } from '@flowatlas/core';

/** The key every fact from a document carries, naming the document. */
export const DECLARED_BY = 'declaredBy';

export interface ReadDocumentOptions {
  /** Service name, which becomes the repo half of every id produced. */
  service: string;
  /**
   * The document's path as a reader should see it, relative to the
   * configuration file. It is the `file` of every node here, so `flow` and
   * `impact` point at the document the way they point at a source file.
   */
  documentPath: string;
  /** Fixed timestamp, for reproducible output. */
  generatedAt?: string;
}

export interface ReadDocumentResult {
  graph: RepoGraph;
  /**
   * How many ends of the service the document declared, for the build's summary.
   *
   * Ends rather than routes, because a route is one format's word for one of
   * them: an AsyncAPI document declares channels it sends on and channels it
   * receives from, and counting those as routes would be the HTTP vocabulary
   * leaking into a graph that no longer has any HTTP in it.
   */
  declared: number;
}

/**
 * Reads one document into the graph of one service.
 *
 * The contract a format's reader satisfies, and the reason a build never
 * branches on which format it is holding: the kind selects the function and
 * everything after that is the same code.
 */
export type DocumentReader = (raw: unknown, options: ReadDocumentOptions) => ReadDocumentResult;

/**
 * Something about the document made it unusable as a whole.
 *
 * Thrown rather than reported, because a document that is not a document is a
 * configuration mistake: the alternative is a service that silently has no
 * routes and no channels, which reads exactly like a service that has none.
 */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

/** A name safe to build a registry entry out of, from a name that may be an address. */
export const shapeName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next === undefined ? '' : next.toUpperCase(),
  );
  return cleaned === '' ? 'Anonymous' : `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
};
