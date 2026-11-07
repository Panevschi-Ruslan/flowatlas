import type { DocumentReading } from './documents.js';
import type { Operation, SelectedField } from './operations.js';

/** The key of a request node's `meta` that holds the operation it sends (P232). */
export const GRAPHQL_META = 'graphql';

/**
 * One selected field, as a request node keeps it: its line in the file the
 * document is written in, or in the file of the fragment it came from when
 * that is another (`file`).
 */
export interface MetaField {
  readonly field: string;
  readonly alias?: string;
  readonly arguments?: readonly string[];
  readonly on?: string;
  readonly file?: string;
  readonly line: number;
  readonly selections?: readonly MetaField[];
}

/**
 * What a request sends, on its node: the operation, the root fields with
 * what is selected under each, the variables it declares, and where the
 * document is. Read by the linker to join the fields, and by `contracts` to
 * compare them with the schema.
 */
export interface GraphqlCallMeta {
  readonly operation: 'query' | 'mutation' | 'subscription';
  readonly name?: string;
  readonly fields: readonly MetaField[];
  readonly variables: Operation['variables'];
  readonly document: { readonly file: string; readonly line: number };
  readonly library: string;
  readonly transport?: 'ws';
  readonly missingFragments?: readonly string[];
}

const fieldMeta = (reading: Extract<DocumentReading, { kind: 'read' }>, fileOf: (path: string) => string, field: SelectedField): MetaField => {
  const written = field.written ?? reading.written;
  return {
    field: field.field,
    ...(field.alias === undefined ? {} : { alias: field.alias }),
    ...(field.arguments.length === 0 ? {} : { arguments: field.arguments }),
    ...(field.on === undefined ? {} : { on: field.on }),
    ...(written.path === reading.written.path ? {} : { file: fileOf(written.path) }),
    line: written.lineAt(field.at),
    ...(field.selections.length === 0 ? {} : { selections: field.selections.map((inner) => fieldMeta(reading, fileOf, inner)) }),
  };
};

/** What a request node keeps of an operation; `fileOf` names a file the way the node's own is named. */
export const operationMeta = (
  operation: Operation,
  reading: Extract<DocumentReading, { kind: 'read' }>,
  fileOf: (path: string) => string,
  library: string,
  transport?: 'ws',
): GraphqlCallMeta => ({
  operation: operation.operation,
  ...(operation.name === undefined ? {} : { name: operation.name }),
  fields: operation.fields.map((field) => fieldMeta(reading, fileOf, field)),
  variables: operation.variables,
  document: { file: fileOf(reading.written.path), line: reading.written.lineAt(operation.at) },
  library,
  ...(transport === undefined && operation.operation !== 'subscription' ? {} : { transport: 'ws' as const }),
  ...(operation.missingFragments.length === 0 ? {} : { missingFragments: operation.missingFragments }),
});
