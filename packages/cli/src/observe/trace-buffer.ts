import type { ObservedSpan } from './span.js';

/**
 * Spans a listener holds until their trace is whole (P109 D3).
 *
 * A server span meets its caller's client span only when both are matched in
 * one go, and an exporter in each service posts its own spans when it likes,
 * so a trace's spans arrive in several posts. The buffer keeps the spans of a
 * trace together, by trace id, and hands a trace back as a whole once nothing
 * has been added to it for `waitMs`, or early, oldest first, when it would
 * hold more than `maxSpans` spans or `maxTraces` traces.
 *
 * Only reduced spans go in (what a reader's allow-list kept), so the buffer
 * holds nothing a request carried that the observed file could not; and it
 * is bounded in size and in time, so a trace id held here (the only place one
 * is held under `--no-samples`) lives at most `waitMs` past its last span.
 */

export const TRACE_BUFFER_SPANS = 10_000;
export const TRACE_BUFFER_TRACES = 2_000;

export interface TraceBufferOptions {
  /** How long a trace waits for more spans after its last one, in ms. */
  waitMs: number;
  maxSpans?: number;
  maxTraces?: number;
}

interface Held {
  spans: ObservedSpan[];
  /** When a span was last added, in ms. */
  last: number;
}

export class TraceBuffer {
  private readonly traces = new Map<string, Held>();
  private held = 0;
  private cut = 0;
  private readonly waitMs: number;
  private readonly maxSpans: number;
  private readonly maxTraces: number;

  constructor(options: TraceBufferOptions) {
    this.waitMs = options.waitMs;
    this.maxSpans = options.maxSpans ?? TRACE_BUFFER_SPANS;
    this.maxTraces = options.maxTraces ?? TRACE_BUFFER_TRACES;
  }

  /** Spans held now. */
  get spans(): number {
    return this.held;
  }

  /** Traces held now. */
  get size(): number {
    return this.traces.size;
  }

  /** Traces handed back before their wait was over, because the buffer was full. */
  get cutShort(): number {
    return this.cut;
  }

  /**
   * Adds spans at time `now`, and gives back the traces the buffer had to let
   * go to stay inside its bounds: the ones least recently added to, first.
   */
  add(spans: readonly ObservedSpan[], now: number): ObservedSpan[][] {
    for (const span of spans) {
      const held = this.traces.get(span.traceId);
      // Taken out and put back, so the map stays in the order traces were last added to.
      if (held !== undefined) this.traces.delete(span.traceId);
      const trace = held ?? { spans: [], last: now };
      trace.spans.push(span);
      trace.last = now;
      this.traces.set(span.traceId, trace);
      this.held += 1;
    }
    const out: ObservedSpan[][] = [];
    while (this.held > this.maxSpans || this.traces.size > this.maxTraces) {
      out.push(this.shift()!);
      this.cut += 1;
    }
    return out;
  }

  /** The traces nothing was added to for `waitMs` before `now`, oldest first. */
  expired(now: number): ObservedSpan[][] {
    const out: ObservedSpan[][] = [];
    for (const [, trace] of this.traces) {
      if (now - trace.last < this.waitMs) break;
      out.push(this.shift()!);
    }
    return out;
  }

  /** Every trace held, oldest first, leaving the buffer empty: on exit. */
  drain(): ObservedSpan[][] {
    const out: ObservedSpan[][] = [];
    while (this.traces.size > 0) out.push(this.shift()!);
    return out;
  }

  private shift(): ObservedSpan[] | undefined {
    const first = this.traces.entries().next();
    if (first.done === true) return undefined;
    const [traceId, trace] = first.value;
    this.traces.delete(traceId);
    this.held -= trace.spans.length;
    return trace.spans;
  }
}
