/**
 * An OTLP/JSON document written as the protobuf `ExportTraceServiceRequest`
 * an exporter sends (dev only, not packaged).
 *
 * Every field is written, span names, status messages, events and attributes
 * off the list included, so the decoder (`packages/cli/src/observe/otlp-protobuf.ts`)
 * is shown to skip them rather than never meeting them. Used by its test and by
 * `observe-send.mjs`, which posts the fixtures' traces to `observe --listen`.
 */

const varint = (value) => {
  let rest = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  do {
    const low = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest === 0n ? low : low | 0x80);
  } while (rest !== 0n);
  return bytes;
};
const tag = (no, wire) => varint((no << 3) | wire);
const bytesField = (no, bytes) => [...tag(no, 2), ...varint(bytes.length), ...bytes];
const textField = (no, value) => bytesField(no, [...Buffer.from(value, 'utf8')]);
const varintField = (no, value) => [...tag(no, 0), ...varint(value)];
const fixed64Field = (no, value) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, value, true);
  return [...tag(no, 1), ...new Uint8Array(view.buffer)];
};
const doubleField = (no, value) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return [...tag(no, 1), ...new Uint8Array(view.buffer)];
};
const hexBytes = (hex) => [...Buffer.from(hex, 'hex')];

const KINDS = {
  SPAN_KIND_INTERNAL: 1,
  SPAN_KIND_SERVER: 2,
  SPAN_KIND_CLIENT: 3,
  SPAN_KIND_PRODUCER: 4,
  SPAN_KIND_CONSUMER: 5,
};

const anyValue = (value) => {
  if (typeof value.stringValue === 'string') return textField(1, value.stringValue);
  if (typeof value.boolValue === 'boolean') return varintField(2, value.boolValue ? 1 : 0);
  if (value.intValue !== undefined) return varintField(3, BigInt(value.intValue));
  if (typeof value.doubleValue === 'number') return doubleField(4, value.doubleValue);
  if (value.arrayValue !== undefined) {
    return bytesField(5, value.arrayValue.values.flatMap((item) => bytesField(1, anyValue(item))));
  }
  return [];
};
const keyValue = (attribute) => [...textField(1, attribute.key), ...bytesField(2, anyValue(attribute.value))];

const span = (raw) => [
  ...bytesField(1, hexBytes(raw.traceId)),
  ...bytesField(2, hexBytes(raw.spanId)),
  ...(raw.parentSpanId === undefined ? [] : bytesField(4, hexBytes(raw.parentSpanId))),
  ...(raw.name === undefined ? [] : textField(5, raw.name)),
  ...varintField(6, typeof raw.kind === 'number' ? raw.kind : (KINDS[raw.kind] ?? 1)),
  ...(raw.startTimeUnixNano === undefined ? [] : fixed64Field(7, BigInt(raw.startTimeUnixNano))),
  ...(raw.endTimeUnixNano === undefined ? [] : fixed64Field(8, BigInt(raw.endTimeUnixNano))),
  ...(raw.attributes ?? []).flatMap((attribute) => bytesField(9, keyValue(attribute))),
  ...(raw.events ?? []).flatMap((event) =>
    bytesField(11, [...textField(3, event.name), ...(event.attributes ?? []).flatMap((a) => bytesField(4, keyValue(a)))]),
  ),
  ...(raw.status === undefined
    ? []
    : bytesField(15, [...(raw.status.message === undefined ? [] : textField(2, raw.status.message)), ...varintField(3, raw.status.code)])),
];

/** An OTLP/JSON document as protobuf bytes. */
export const encodeTraceRequest = (document) =>
  new Uint8Array(
    document.resourceSpans.flatMap((resourceSpans) =>
      bytesField(1, [
        ...bytesField(1, (resourceSpans.resource?.attributes ?? []).flatMap((a) => bytesField(1, keyValue(a)))),
        ...resourceSpans.scopeSpans.flatMap((scope) =>
          bytesField(2, [
            ...(scope.scope === undefined ? [] : bytesField(1, textField(1, scope.scope.name))),
            ...scope.spans.flatMap((raw) => bytesField(2, span(raw))),
          ]),
        ),
      ]),
    ),
  );
