/**
 * A written document read back by the reader of its format (P118, D3).
 *
 * The writer is the reader inverted, so the reader must find in what was
 * written the same routes and the same channel ends the graph had: if it does
 * not, one of the two is wrong, and that is a bug in flowatlas rather than a
 * fact about the project, said as such.
 */
import { readAsyncapiDocument } from '../asyncapi/read.js';
import { readOpenapiDocument } from '../openapi/read.js';
import type { WrittenSpec } from './written.js';

const FIXED = '1970-01-01T00:00:00.000Z';

/** What the reader finds: routes as `VERB:/path`, channel ends as `emits|channel:x`. */
const readBack = (spec: WrittenSpec): string[] => {
  const options = { service: spec.service, documentPath: `${spec.name}.${spec.kind}`, generatedAt: FIXED };
  if (spec.kind === 'openapi') {
    const prefix = `entry:${spec.service}:http:`;
    return readOpenapiDocument(spec.document, options)
      .graph.nodes.filter((node) => node.type === 'entry' && node.id.startsWith(prefix))
      .map((node) => node.id.slice(prefix.length));
  }
  const { graph } = readAsyncapiDocument(spec.document, options);
  return graph.edges.flatMap((edge) =>
    edge.type === 'emits' ? [`emits|${edge.to}`] : edge.type === 'consumes' ? [`consumes|${edge.from}`] : [],
  );
};

/** What the writer meant to write, in the same words. */
const meant = (spec: WrittenSpec): string[] =>
  spec.operations.flatMap((operation) => {
    if (operation.kind === 'http') return operation.route === undefined ? [] : [operation.route];
    if (operation.channel === undefined) return [];
    return [`${operation.kind === 'send' ? 'emits' : 'consumes'}|${operation.channel}`];
  });

/** Every difference between what was written and what reads back; empty when they agree. */
export const verifyWritten = (spec: WrittenSpec): string[] => {
  let found: Set<string>;
  try {
    found = new Set(readBack(spec));
  } catch (error) {
    return [`${spec.name}.${spec.kind}: the reader refused what was written: ${error instanceof Error ? error.message : String(error)}`];
  }
  const wanted = new Set(meant(spec));
  return [
    ...[...wanted].filter((key) => !found.has(key)).sort().map((key) => `${spec.name}.${spec.kind}: ${key} was written and does not read back`),
    ...[...found].filter((key) => !wanted.has(key)).sort().map((key) => `${spec.name}.${spec.kind}: ${key} reads back and was not written`),
  ];
};
