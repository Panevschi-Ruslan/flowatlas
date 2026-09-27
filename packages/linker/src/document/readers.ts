/**
 * Which reader reads a document of which kind.
 *
 * The one place that decides what a document's kind means, and the reason
 * configuration says `document: { kind, path }` rather than growing a key per
 * format. A second scalar beside `openapi` would have had "which format is
 * this" answered in the configuration schema, again in whatever asks whether a
 * service is declared, and a third time wherever a reader is picked — three
 * answers to one question, kept in step by hand.
 *
 * A lookup rather than a run of branches, so a third format is a line here and
 * nothing else, and so the kinds that exist can be printed at somebody who
 * misspelled one.
 */
import { readAsyncapiDocument } from '../asyncapi/read.js';
import { readOpenapiDocument } from '../openapi/read.js';
import { DocumentError, type DocumentReader } from './declared.js';

/**
 * A `Map` and not an object literal: the kind looked up is a word out of the
 * user's configuration file, and an object answers `constructor` with a
 * function where it should answer with nothing at all (R134).
 */
export const DOCUMENT_READERS: ReadonlyMap<string, DocumentReader> = new Map([
  ['openapi', readOpenapiDocument],
  ['asyncapi', readAsyncapiDocument],
]);

/** The kinds a document may be, which is exactly the readers there are. */
export const DOCUMENT_KINDS: readonly string[] = [...DOCUMENT_READERS.keys()].sort();

/**
 * The reader for one kind, or a refusal naming the kinds there are.
 *
 * Thrown rather than reported for the reason every other failure to read a
 * document is: a service whose document nobody read is a service with no routes
 * and no channels, which looks exactly like a service that has none.
 */
export const documentReader = (kind: string): DocumentReader => {
  const reader = DOCUMENT_READERS.get(kind);
  if (reader === undefined) {
    throw new DocumentError(
      `${kind} is not a kind of document this reads; write one of ${DOCUMENT_KINDS.join(', ')}`,
    );
  }
  return reader;
};
