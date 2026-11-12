/**
 * A gRPC contract's messages as payload types (P287).
 *
 * A method of a `.proto` contract takes one message and answers with one, and
 * the contract says what each holds. Those are the types a caller's request
 * object is compared with, so they are registered as the registry holds any
 * shape - an object entry per message, its fields as type references - under
 * the message's fully qualified name as protoc writes it, with its leading
 * dot, `type:<repo>#.shop.GetCartRequest`, and the entry of a method carries
 * them as a procedure's input and output. The dot keeps a message of a file
 * with no package apart from a TypeScript type of its name, which the type
 * collector registers under the same repository.
 *
 * What a field is, as the libraries hand it to JavaScript:
 *
 * - a name as `@grpc/proto-loader` (without `keepCase`), protobuf.js and
 *   ts-proto write it, `user_id` as `userId`; and as the contract writes it
 *   where the loader is told `keepCase: true` (P293), a message then
 *   registered apart, under its id with `@keepCase` after it;
 * - the 32-bit numbers, `float` and `double` are `number`; the 64-bit ones are
 *   `number | string`, since a loader may be told to hand them as text and a
 *   client may write either; `bool`, `string`; `bytes` is `Buffer | string`;
 * - an enum is its values' names or a number, either of which a client may write;
 * - what a 64-bit integer, `bytes` or an enum is handed to the reader as is
 *   the reader's library's choice (`longs`, `bytes`, `enums` options,
 *   ts-proto's own), so such a field carries `meta.protoForm: 'library'` and
 *   the contract check does not hold a message that sends it to one form;
 * - `repeated T` is `T[]`; a `map<K, V>` is an object nothing here compares key
 *   by key (`object`);
 * - a `oneof` is a choice: the message is a union of one shape per member
 *   chosen, each with the fields outside the choice beside it - up to a few
 *   arms, past which the members are plain optional fields;
 * - the well-known types other than `google.protobuf.Empty` claim nothing:
 *   a `Timestamp` is `{ seconds, nanos }` to a loader and a `Date` to ts-proto.
 *
 * Whether a field must be sent is not the question it is in JSON. A proto3
 * field with no presence is handed to the server as its default where it was
 * not sent, so it is always there for whoever reads the message and never
 * required of whoever writes it: recorded as present (`optional: false`) with
 * `meta.protoPresence: 'implicit'`, which the contract check reads as "may be
 * left out by the sender". A field with presence - a message, `optional`, a
 * member of a `oneof`, every proto2 or editions field not `required` - may be
 * absent for the reader too (`optional: true`). A proto2 `required` field is
 * required.
 */
import type { TypeEntry, TypeField, TypeRegistry } from './model/types.js';
import type { ProtoEnum, ProtoField, ProtoFile, ProtoMessage } from './protobuf.js';
import { structuralHash } from './types/structural-hash.js';

/** One file of a contract, and where it is, for `declaredIn`. */
export interface ProtoSource {
  readonly path: string;
  readonly file: ProtoFile;
}

/** The registry entries of a contract's messages, and the reference of each message a method names. */
export interface ProtoTypes {
  /**
   * The reference of a message as written in a contract, `GetCartRequest` or
   * `.shop.GetCartRequest`, resolved from a scope (`shop`, the service's
   * package) as protoc resolves it; its types are registered. `unknown` for a
   * message nothing here declares.
   */
  refOf(written: string, scope: string | undefined, names?: ProtoFieldNames): string;
  /** Every entry registered so far, each with its hash. */
  registry(): TypeRegistry;
}

const NUMBERS = new Set(['double', 'float', 'int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const LONGS = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const SCALARS: ReadonlyMap<string, string> = new Map([
  ...[...NUMBERS].map((name): [string, string] => [name, 'number']),
  ...[...LONGS].map((name): [string, string] => [name, 'number | string']),
  ['bool', 'boolean'],
  ['string', 'string'],
  ['bytes', 'Buffer | string'],
]);

/** The well-known package, whose types each library maps its own way. */
const WELL_KNOWN = 'google.protobuf.';

/** The one well-known type every library hands the same way: a message with no fields. */
const EMPTY = 'google.protobuf.Empty';

/** How many shapes a message's `oneof`s may make before its members are read as plain optional fields. */
const MOST_ARMS = 8;

/** `user_id` as the libraries write it in JavaScript: `userId`. */
export const protoJsonName = (name: string): string => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const UNKNOWN = 'unknown';

/** A reference with a union in it, bracketed where an array suffix is put after it. */
const element = (ref: string): string => (ref.includes('|') ? `(${ref})` : ref);

/**
 * How a loader names a message's fields (P293): `json`, `user_id` as
 * `userId`, as `@grpc/proto-loader` does by default and protobuf.js and
 * ts-proto do; `proto`, as the contract writes them, which a loader told
 * `keepCase: true` keeps. A message read the second way is registered apart,
 * under its id with `@keepCase` after it, its fields under their own names.
 */
export type ProtoFieldNames = 'json' | 'proto';

/** The types of the messages and enums these files declare, registered under `repo`. */
export const protoTypes = (sources: readonly ProtoSource[], repo: string): ProtoTypes => {
  const messages = new Map<string, { message: ProtoMessage; source: ProtoSource }>();
  const enums = new Map<string, { declared: ProtoEnum; source: ProtoSource }>();
  for (const source of sources) {
    for (const message of source.file.messages) if (!messages.has(message.fullName)) messages.set(message.fullName, { message, source });
    for (const declared of source.file.enums) if (!enums.has(declared.fullName)) enums.set(declared.fullName, { declared, source });
  }
  const registry: TypeRegistry = {};
  const idOf = (name: string, keep = false): string => `type:${repo}#.${name}${keep ? '@keepCase' : ''}`;

  /** The full name a written type stands for, from a scope, as protoc looks it up: innermost first. */
  const resolve = (written: string, scope: string | undefined): string | undefined => {
    if (written.startsWith('.')) {
      const full = written.slice(1);
      return messages.has(full) || enums.has(full) || full.startsWith(WELL_KNOWN) ? full : undefined;
    }
    const parts = scope === undefined || scope === '' ? [] : scope.split('.');
    for (let length = parts.length; length >= 0; length -= 1) {
      const full = [...parts.slice(0, length), written].join('.');
      if (messages.has(full) || enums.has(full)) return full;
    }
    return written.startsWith(WELL_KNOWN) ? written : undefined;
  };

  const declaredIn = (source: ProtoSource): string => `${repo}#${source.path}`;

  const enumRef = (full: string): string => {
    const id = idOf(full);
    if (registry[id] !== undefined) return id;
    const { declared, source } = enums.get(full) as { declared: ProtoEnum; source: ProtoSource };
    registry[id] = {
      name: full,
      kind: 'union',
      declaredIn: declaredIn(source),
      structuralHash: '',
      // Its names, or its numbers: a client may write either.
      members: [...declared.values.map((value) => `'${value}'`), 'number'],
      meta: { declaredBy: 'protobuf', protoEnum: full },
    };
    return id;
  };

  const fieldOf = (field: ProtoField, scope: string, syntax: ProtoFile['syntax'], keep: boolean): TypeField => {
    const base = typeRefOf(field.type, scope, keep);
    const type = field.mapKey !== undefined ? 'object' : field.repeated ? `${element(base)}[]` : base;
    const full = SCALARS.has(field.type) ? undefined : resolve(field.type, scope);
    // A message held in a field has presence in every syntax: it is there or it is not.
    const isMessage = full !== undefined && !enums.has(full);
    const presence: 'implicit' | 'explicit' | undefined =
      field.label === 'required'
        ? undefined
        : field.repeated || field.mapKey !== undefined
          ? 'implicit'
          : field.label === 'optional' || field.oneof !== undefined || isMessage || syntax !== 'proto3'
            ? 'explicit'
            : 'implicit';
    const name = keep ? field.name : protoJsonName(field.name);
    // A 64-bit integer, bytes and an enum reach the reader in the form its
    // library is told to hand them - a number or text, a buffer or base64, a
    // name or a number - which the contract does not say.
    const libraryForm = field.mapKey === undefined && (LONGS.has(field.type) || field.type === 'bytes' || (full !== undefined && enums.has(full)));
    return {
      name,
      type,
      optional: presence === 'explicit',
      meta: {
        ...(presence === undefined ? {} : { protoPresence: presence }),
        ...(libraryForm ? { protoForm: 'library' } : {}),
        ...(name === field.name ? {} : { protoName: field.name }),
        ...(field.oneof === undefined ? {} : { oneof: field.oneof }),
      },
    };
  };

  const messageRef = (full: string, depth: number, keep: boolean): string => {
    const id = idOf(full, keep);
    if (registry[id] !== undefined) return id;
    const { message, source } = messages.get(full) as { message: ProtoMessage; source: ProtoSource };
    // Held before its fields are read, so a message that holds itself stops.
    const meta = { declaredBy: 'protobuf', protoMessage: full, ...(keep ? { protoFieldNames: 'proto' } : {}) };
    const entry: TypeEntry = { name: full, kind: 'object', declaredIn: declaredIn(source), structuralHash: '', fields: [], meta };
    registry[id] = entry;
    const fields = message.fields.map((field) => fieldOf(field, full, source.file.syntax, keep));
    const groups = new Map<string, TypeField[]>();
    for (const field of fields) {
      const group = field.meta?.['oneof'];
      if (typeof group !== 'string') continue;
      groups.set(group, [...(groups.get(group) ?? []), field]);
    }
    const arms = [...groups.values()].reduce((count, members) => count * members.length, 1);
    if (groups.size === 0 || arms > MOST_ARMS || depth > 16) {
      entry.fields = fields;
      return id;
    }
    // One shape per member chosen in each choice, the fields outside every choice in each.
    const outside = fields.filter((field) => typeof field.meta?.['oneof'] !== 'string');
    let chosen: TypeField[][] = [[]];
    for (const members of groups.values()) chosen = chosen.flatMap((picked) => members.map((member) => [...picked, member]));
    const members: string[] = [];
    for (const picked of chosen) {
      const armName = `${full}/${picked.map((field) => field.name).join('+')}`;
      const armId = idOf(armName, keep);
      registry[armId] = { name: armName, kind: 'object', declaredIn: entry.declaredIn, structuralHash: '', fields: [...outside, ...picked], meta: { ...meta, oneofArm: picked.map((field) => field.name) } };
      members.push(armId);
    }
    delete entry.fields;
    registry[id] = { ...entry, kind: 'union', members };
    return id;
  };

  const emptyRef = (): string => {
    const id = idOf(EMPTY);
    registry[id] ??= { name: EMPTY, kind: 'object', declaredIn: `${repo}#${EMPTY}`, structuralHash: '', fields: [], meta: { declaredBy: 'protobuf', protoMessage: EMPTY } };
    return id;
  };

  let depth = 0;
  const typeRefOf = (written: string, scope: string | undefined, keep: boolean): string => {
    const scalar = SCALARS.get(written);
    if (scalar !== undefined) return scalar;
    const full = resolve(written, scope);
    if (full === undefined) return UNKNOWN;
    if (full === EMPTY) return emptyRef();
    if (full.startsWith(WELL_KNOWN)) return UNKNOWN;
    if (enums.has(full)) return enumRef(full);
    depth += 1;
    try {
      return messageRef(full, depth, keep);
    } finally {
      depth -= 1;
    }
  };

  return {
    refOf: (written, scope, names = 'json') => typeRefOf(written, scope, names === 'proto'),
    registry: () => {
      for (const entry of Object.values(registry)) entry.structuralHash = structuralHash(entry, registry);
      return registry;
    },
  };
};

/**
 * A service a package implements and hands a server (P287): health checking
 * and reflection, which any gRPC server may answer and no contract of the
 * repository declares. The package's contract is the protocol's own, written
 * here as far as the packages implement it, so its methods are named and typed
 * as a repository's own contract would be.
 */
export interface GrpcPackageContract {
  /** What the package is known by: a word its name holds, `health`, `reflection`. */
  readonly word: string;
  /** Where the contract is said to be, as the protocol keeps it. */
  readonly path: string;
  /** The contract, as `.proto` text. */
  readonly text: string;
}

export const GRPC_PACKAGE_CONTRACTS: readonly GrpcPackageContract[] = [
  {
    word: 'health',
    path: 'grpc/health/v1/health.proto',
    text: [
      'syntax = "proto3";',
      'package grpc.health.v1;',
      'message HealthCheckRequest { string service = 1; }',
      'message HealthCheckResponse {',
      '  enum ServingStatus { UNKNOWN = 0; SERVING = 1; NOT_SERVING = 2; SERVICE_UNKNOWN = 3; }',
      '  ServingStatus status = 1;',
      '}',
      'service Health {',
      '  rpc Check (HealthCheckRequest) returns (HealthCheckResponse);',
      '  rpc Watch (HealthCheckRequest) returns (stream HealthCheckResponse);',
      '}',
    ].join('\n'),
  },
  // Both versions the packages answer; their messages are a choice of requests nothing here compares.
  ...['v1', 'v1alpha'].map((version) => ({
    word: 'reflection',
    path: `grpc/reflection/${version}/reflection.proto`,
    text: [
      'syntax = "proto3";',
      `package grpc.reflection.${version};`,
      'service ServerReflection {',
      '  rpc ServerReflectionInfo (stream ServerReflectionRequest) returns (stream ServerReflectionResponse);',
      '}',
    ].join('\n'),
  })),
];
