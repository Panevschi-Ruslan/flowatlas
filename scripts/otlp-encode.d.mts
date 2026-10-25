/** An OTLP/JSON document (`{ resourceSpans: [...] }`) as the protobuf `ExportTraceServiceRequest` an exporter sends. */
export declare const encodeTraceRequest: (document: Record<string, any>) => Uint8Array;
