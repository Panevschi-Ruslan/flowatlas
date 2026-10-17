import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSERVED_KEPT } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { TRACE_READERS } from './readers.js';
import { KEPT_FIELDS, keepAllowed, type ObservedSpan } from './span.js';

const traces = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo/traces');
const documents = readdirSync(traces).map((file) => JSON.parse(readFileSync(join(traces, file), 'utf8')) as unknown);

describe('the allow-list every reader ends with', () => {
  it('is the list the observed file names as kept', () => {
    expect([...KEPT_FIELDS]).toEqual([...OBSERVED_KEPT]);
  });

  it('drops every key not on it, and every undefined', () => {
    const span = {
      traceId: 't',
      spanId: 's',
      kind: 'server',
      method: 'GET',
      route: undefined,
      name: 'GET /orders/ord-1',
      'http.request.header.cookie': 'sid=1',
      statement: 'select 1',
    } as unknown as ObservedSpan;
    expect(keepAllowed(span)).toEqual({ traceId: 't', spanId: 's', kind: 'server', method: 'GET' });
  });

  it('leaves no key outside it on any span, from every reader over every fixture trace', () => {
    const kept = new Set<string>(KEPT_FIELDS);
    let read = 0;
    for (const reader of TRACE_READERS.values()) {
      for (const document of documents.filter((one) => reader.sniff(one))) {
        for (const span of reader.read(document).spans) {
          for (const key of Object.keys(span)) expect(kept.has(key), `${reader.name}: ${key}`).toBe(true);
          read += 1;
        }
      }
    }
    expect(read).toBeGreaterThan(20);
  });
});
