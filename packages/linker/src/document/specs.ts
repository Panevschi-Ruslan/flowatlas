/**
 * Every document the services named have (P118): an OpenAPI document per
 * application that answers routes, an AsyncAPI document per service that has
 * a channel end, only what each service has.
 */
import type { GraphLookup } from '@flowatlas/contracts';
import { writeAsyncapiDocument } from '../asyncapi/write.js';
import { writeOpenapiDocuments } from '../openapi/write.js';
import { cmp, type SpecKind, type SpecOptions, type WrittenSpec } from './written.js';

/** Which documents to write: one format, or both. */
export const SPEC_WANTED = ['openapi', 'asyncapi', 'both'] as const;
export type SpecWanted = (typeof SPEC_WANTED)[number];

const wants = (wanted: SpecWanted, kind: SpecKind): boolean => wanted === 'both' || wanted === kind;

/** The documents, by name then format, so a run lists them the same way every time. */
export const writeSpecs = (
  lookup: GraphLookup,
  services: readonly string[],
  options: SpecOptions & { kind?: SpecWanted } = {},
): WrittenSpec[] => {
  const wanted = options.kind ?? 'both';
  const written: WrittenSpec[] = [];
  for (const service of services) {
    if (wants(wanted, 'openapi')) written.push(...writeOpenapiDocuments(lookup, service, options));
    if (wants(wanted, 'asyncapi')) {
      const document = writeAsyncapiDocument(lookup, service, options);
      if (document !== undefined) written.push(document);
    }
  }
  return written.sort((a, b) => cmp(a.name, b.name) || cmp(a.kind, b.kind));
};
