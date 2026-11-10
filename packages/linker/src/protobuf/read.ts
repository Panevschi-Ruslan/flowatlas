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
import { DECLARED_CONFIDENCE, grpcCallKind, grpcEntryKey, makeEntryId, makeSymbolId, parseProto, SCHEMA_VERSION, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { DECLARED_BY, DocumentError, type ReadDocumentOptions, type ReadDocumentResult } from '../document/declared.js';

export const readProtobufDocument = (raw: unknown, options: ReadDocumentOptions): ReadDocumentResult => {
  const { service, documentPath } = options;
  if (typeof raw !== 'string') throw new DocumentError(`${documentPath} is not a .proto file`);
  const file = parseProto(raw);
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
    graph: { schemaVersion: SCHEMA_VERSION, repo: service, generatedAt: options.generatedAt ?? new Date().toISOString(), nodes, edges, types: {}, unresolved: [], meta: { ...declared } },
  };
};
