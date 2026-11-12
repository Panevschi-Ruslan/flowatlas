/**
 * A service declared by a protocol buffer file (P274).
 *
 * A gRPC service written in another language is one the readers here cannot
 * open, and the contract the repository shares with it says exactly what a
 * join needs: each method's path and how it is called. So a service may be
 * configured by the file, `document: { kind: 'protobuf', path, services }`,
 * and each method of the services it names is an `rpc` way in keyed as a
 * server's own would be, `grpc:shop.CartService/GetCart`, which a client's
 * call joins to. A file shared by every service of the repository declares
 * them all; `services` names the ones this service answers, and without it
 * every service of the file is this one's.
 */
import {
  DECLARED_CONFIDENCE,
  grpcCallKind,
  grpcEntryKey,
  makeEntryId,
  makeSymbolId,
  parseProto,
  protoTypes,
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProtoSource,
} from '@flowatlas/core';
import { DECLARED_BY, DocumentError, type ReadDocumentOptions, type ReadDocumentResult } from '../document/declared.js';

/** How many files a contract's imports are followed through for the messages they declare. */
const MAX_IMPORTS = 32;

/**
 * The file and the files it imports, as far as they are beside it (P287): a
 * message a method takes may be declared in a file the contract imports,
 * looked for relative to the contract's directory as protoc's include path
 * most often has it. One not found declares nothing, and a field of its type
 * claims nothing; the well-known types are never looked for.
 */
const sourcesOf = (documentPath: string, text: string, readBeside: ReadDocumentOptions['readBeside']): ProtoSource[] => {
  const sources: ProtoSource[] = [{ path: documentPath, file: parseProto(text) }];
  const seen = new Set<string>();
  for (let index = 0; index < sources.length && sources.length < MAX_IMPORTS; index += 1) {
    for (const imported of (sources[index] as ProtoSource).file.imports) {
      if (seen.has(imported) || imported.startsWith('google/protobuf/')) continue;
      seen.add(imported);
      const beside = readBeside?.(imported);
      if (beside !== undefined) sources.push({ path: imported, file: parseProto(beside) });
    }
  }
  return sources;
};

export const readProtobufDocument = (raw: unknown, options: ReadDocumentOptions): ReadDocumentResult => {
  const { service, documentPath } = options;
  if (typeof raw !== 'string') throw new DocumentError(`${documentPath} is not a .proto file`);
  const file = parseProto(raw);
  const types = protoTypes(sourcesOf(documentPath, raw, options.readBeside), service);
  const named = options.services;
  const services = file.services.filter((each) => named === undefined || named.includes(each.fullName) || named.includes(each.name));
  if (file.services.length === 0) throw new DocumentError(`${documentPath} declares no service`);
  const missing = (named ?? []).filter((name) => !file.services.some((each) => each.fullName === name || each.name === name));
  if (missing.length > 0) {
    throw new DocumentError(`${documentPath} declares no service ${missing.join(', ')}; it declares ${file.services.map((each) => each.fullName).join(', ')}`);
  }
  const declared = { [DECLARED_BY]: documentPath };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const each of services) {
    for (const method of each.methods) {
      const key = grpcEntryKey(each.fullName, method.name);
      const entryId = makeEntryId(service, 'rpc', key);
      const handlerId = makeSymbolId(service, documentPath, `${each.fullName}.${method.name}`);
      nodes.push({
        id: entryId,
        type: 'entry',
        label: `grpc ${each.fullName}/${method.name}`,
        repo: service,
        file: documentPath,
        line: method.line,
        kind: 'rpc',
        meta: {
          key,
          call: grpcCallKind(method),
          service: each.fullName,
          method: method.name,
          request: method.request,
          response: method.response,
          contract: documentPath,
          // The messages as a procedure's input and output (P287).
          signature: { params: [{ name: 'request', type: types.refOf(method.request, file.package) }], returns: types.refOf(method.response, file.package) },
          adapter: 'protobuf-document',
          ...declared,
        },
      });
      nodes.push({ id: handlerId, type: 'method', label: `${each.name}.${method.name}`, repo: service, file: documentPath, line: method.line, meta: { ...declared } });
      edges.push({ from: entryId, to: handlerId, type: 'handles', confidence: DECLARED_CONFIDENCE, file: documentPath, meta: { ...declared } });
    }
  }
  return {
    declared: nodes.filter((node) => node.type === 'entry').length,
    graph: { schemaVersion: SCHEMA_VERSION, repo: service, generatedAt: options.generatedAt ?? new Date().toISOString(), nodes, edges, types: types.registry(), unresolved: [], meta: { ...declared } },
  };
};
