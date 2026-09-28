import { describe, expect, it } from 'vitest';
import { DOCUMENT_KINDS, documentReader } from './readers.js';

/**
 * The kind is a word out of the user's configuration file - `document: { kind,
 * path }` - so the table that answers it can be asked about anything at all,
 * including the words the language puts on every object. While it was an object
 * literal, `constructor` had an answer and a service would have been "read" by
 * it (R134).
 */
describe('the reader for a kind of document', () => {
  it('has one for every kind it lists', () => {
    expect(DOCUMENT_KINDS).toEqual(['asyncapi', 'openapi']);
    for (const kind of DOCUMENT_KINDS) {
      expect(typeof documentReader(kind), kind).toBe('function');
    }
  });

  it('refuses a kind spelled like a member every object has, by name', () => {
    for (const kind of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(() => documentReader(kind), kind).toThrow(
        `${kind} is not a kind of document this reads; write one of asyncapi, openapi`,
      );
    }
  });
});
