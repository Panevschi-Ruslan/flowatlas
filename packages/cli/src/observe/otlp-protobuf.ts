/**
 * OTLP protobuf (`ExportTraceServiceRequest`) read into the shape the OTLP
 * reader takes from JSON (P105), with no dependency: the wire format is four
 * kinds of field, and only a handful of field numbers are read.
 *
 * The attribute allow-list runs at `KeyValue`: a key off the list is counted
 * and its value is skipped as bytes, never decoded, so a header or a statement
 * never becomes a string. Span names (field 5), events, links and the status
 * message are skipped the same way.
 *
 * Field numbers, from `opentelemetry/proto/trace/v1/trace.proto` and
 * `common/v1/common.proto`:
 *   ExportTraceServiceRequest  resource_spans = 1
 *   ResourceSpans              resource = 1, scope_spans = 2
 *   Resource                   attributes = 1
 *   ScopeSpans                 spans = 2
 *   Span                       trace_id = 1, span_id = 2, parent_span_id = 4, kind = 6,
 *                              start_time_unix_nano = 7 (fixed64), end_time_unix_nano = 8 (fixed64),
 *                              attributes = 9, status = 15
 *   Status                     code = 3
 *   KeyValue                   key = 1, value = 2
 *   AnyValue                   string_value = 1, bool_value = 2, int_value = 3, double_value = 4
 */

/** Bytes that are not a trace request, and where reading them stopped. */
export class ProtobufError extends Error {
  constructor(
    readonly byte: number,
    why: string,
  ) {
    super(`${why} at byte ${byte}`);
  }
}

const VARINT = 0;
const FIXED64 = 1;
const BYTES = 2;
const FIXED32 = 5;

/** A field as read: its number, and its value as a number, a 64-bit number, or a slice of bytes. */
type Field = { no: number; wire: 0 | 1; value: bigint } | { no: number; wire: 2; value: Uint8Array } | { no: number; wire: 5 };

/** The fields of one message, in order; a truncated field or an unknown wire type throws. */
const fieldsOf = function* (bytes: Uint8Array, offset: number): Generator<Field & { at: number }> {
  let at = 0;
  const varint = (): bigint => {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (at >= bytes.length) throw new ProtobufError(offset + at, 'a number runs past the end');
      const byte = bytes[at]!;
      at += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
    }
    throw new ProtobufError(offset + at, 'a number is longer than ten bytes');
  };
  while (at < bytes.length) {
    const start = at;
    const tag = varint();
    const no = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (no === 0) throw new ProtobufError(offset + start, 'field number 0');
    if (wire === VARINT) yield { no, wire, value: varint(), at: offset + start };
    else if (wire === FIXED64) {
      if (at + 8 > bytes.length) throw new ProtobufError(offset + at, 'a 64-bit field runs past the end');
      const value = new DataView(bytes.buffer, bytes.byteOffset + at, 8).getBigUint64(0, true);
      at += 8;
      yield { no, wire, value, at: offset + start };
    } else if (wire === BYTES) {
      const length = Number(varint());
      if (at + length > bytes.length) throw new ProtobufError(offset + at, 'a field runs past the end');
      const value = bytes.subarray(at, at + length);
      const valueAt = offset + at;
      at += length;
      yield { no, wire, value, at: valueAt };
    } else if (wire === FIXED32) {
      if (at + 4 > bytes.length) throw new ProtobufError(offset + at, 'a 32-bit field runs past the end');
      at += 4;
      yield { no, wire, at: offset + start };
    } else throw new ProtobufError(offset + start, `wire type ${wire}`);
  }
};

const utf8 = new TextDecoder('utf-8', { fatal: true });

const textOf = (bytes: Uint8Array, at: number): string => {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new ProtobufError(at, 'a string is not UTF-8');
  }
};

const hexOf = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** A message field's sub-fields, read relative to where the field's bytes start. */
const sub = (field: Field & { at: number }): Generator<Field & { at: number }> =>
  fieldsOf((field as { value: Uint8Array }).value, field.at);

const isBytes = (field: Field): field is Field & { wire: 2; value: Uint8Array } => field.wire === BYTES;
const isNumber = (field: Field): field is Field & { wire: 0 | 1; value: bigint } => field.wire === VARINT || field.wire === FIXED64;

type JsonValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };

/** Signed 64-bit from the varint's two's complement. */
const int64 = (value: bigint): bigint => BigInt.asIntN(64, value);

const anyValueOf = (field: Field & { at: number }): JsonValue | undefined => {
  let value: JsonValue | undefined;
  for (const part of sub(field)) {
    if (part.no === 1 && isBytes(part)) value = { stringValue: textOf(part.value, part.at) };
    else if (part.no === 2 && isNumber(part)) value = { boolValue: part.value !== 0n };
    else if (part.no === 3 && isNumber(part)) value = { intValue: String(int64(part.value)) };
    else if (part.no === 4 && part.wire === FIXED64) {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, part.value, true);
      value = { doubleValue: view.getFloat64(0, true) };
    }
  }
  return value;
};

interface Keep {
  keys: ReadonlySet<string>;
  dropped: { count: number };
}

/** A `KeyValue`, or nothing when its key is off the list: then its value is never decoded. */
const keyValueOf = (field: Field & { at: number }, keep: Keep): { key: string; value: JsonValue } | undefined => {
  let key: string | undefined;
  let raw: (Field & { at: number }) | undefined;
  for (const part of sub(field)) {
    if (part.no === 1 && isBytes(part)) key = textOf(part.value, part.at);
    else if (part.no === 2 && isBytes(part)) raw = part;
  }
  if (key === undefined) return undefined;
  if (!keep.keys.has(key)) {
    keep.dropped.count += 1;
    return undefined;
  }
  const value = raw === undefined ? undefined : anyValueOf(raw);
  return value === undefined ? undefined : { key, value };
};

const attributeOf = (field: Field & { at: number }, keep: Keep, into: Array<{ key: string; value: JsonValue }>): void => {
  const kept = keyValueOf(field, keep);
  if (kept !== undefined) into.push(kept);
};

const spanOf = (field: Field & { at: number }, keep: Keep): Record<string, unknown> => {
  const span: Record<string, unknown> = {};
  const attributes: Array<{ key: string; value: JsonValue }> = [];
  for (const part of sub(field)) {
    if (isBytes(part) && part.no === 1) span['traceId'] = hexOf(part.value);
    else if (isBytes(part) && part.no === 2) span['spanId'] = hexOf(part.value);
    else if (isBytes(part) && part.no === 4 && part.value.length > 0) span['parentSpanId'] = hexOf(part.value);
    else if (isNumber(part) && part.no === 6) span['kind'] = Number(part.value);
    else if (part.wire === FIXED64 && part.no === 7) span['startTimeUnixNano'] = String(part.value);
    else if (part.wire === FIXED64 && part.no === 8) span['endTimeUnixNano'] = String(part.value);
    else if (isBytes(part) && part.no === 9) attributeOf(part, keep, attributes);
    else if (isBytes(part) && part.no === 15) {
      for (const status of sub(part)) if (isNumber(status) && status.no === 3) span['status'] = { code: Number(status.value) };
    }
  }
  span['attributes'] = attributes;
  return span;
};

const resourceSpansOf = (field: Field & { at: number }, keep: Keep): Record<string, unknown> => {
  const attributes: Array<{ key: string; value: JsonValue }> = [];
  const scopeSpans: Array<{ spans: Record<string, unknown>[] }> = [];
  for (const part of sub(field)) {
    if (isBytes(part) && part.no === 1) {
      for (const attribute of sub(part)) if (isBytes(attribute) && attribute.no === 1) attributeOf(attribute, keep, attributes);
    } else if (isBytes(part) && part.no === 2) {
      const spans: Record<string, unknown>[] = [];
      for (const span of sub(part)) if (isBytes(span) && span.no === 2) spans.push(spanOf(span, keep));
      scopeSpans.push({ spans });
    }
  }
  return { resource: { attributes }, scopeSpans };
};

/**
 * An `ExportTraceServiceRequest` as OTLP/JSON's shape (`resourceSpans`), with
 * only the attributes `keep` names, and `droppedAttributes`, how many it did
 * not. Ids are lower-case hex and times decimal strings, as JSON writes them.
 * Throws `ProtobufError` on bytes that are not one.
 */
export const decodeTraceRequest = (
  bytes: Uint8Array,
  keep: ReadonlySet<string>,
): { resourceSpans: Record<string, unknown>[]; droppedAttributes: number } => {
  const kept: Keep = { keys: keep, dropped: { count: 0 } };
  const resourceSpans: Record<string, unknown>[] = [];
  for (const field of fieldsOf(bytes, 0)) {
    if (field.no === 1) {
      if (!isBytes(field)) throw new ProtobufError(field.at, 'resource_spans is not a message');
      resourceSpans.push(resourceSpansOf(field, kept));
    }
  }
  return { resourceSpans, droppedAttributes: kept.dropped.count };
};
