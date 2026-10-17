import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSERVED_KEPT } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { documentsOf } from '../commands/observe.js';
import { BODY_VALUES, PLANTED } from './__fixtures__/planted.js';
import { TRACE_READERS } from './readers/index.js';
import { KEPT_FIELDS, keepAllowed, type ObservedSpan } from './span.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');
/** Every trace and export of the fixtures, each document as `observe` hands it to a reader. */
const documents = ['multi-repo/traces', 'lambda-traces/traces', 'lambda-traces/exports'].flatMap((dir) =>
  readdirSync(join(fixtures, dir))
    .filter((file) => !file.endsWith('.pb'))
    .flatMap((file) => documentsOf(file, readFileSync(join(fixtures, dir, file)))),
);

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
    const read = new Map<string, number>();
    for (const reader of TRACE_READERS.values()) {
      for (const document of documents.filter((one) => reader.sniff(one))) {
        // The two exports that need a name are given one, as their flag would; a HAR its front end, `web`.
        const service = reader.name === 'har' ? 'web' : undefined;
        for (const span of reader.read(document, service, { workflow: 'w', function: 'f' }).spans) {
          for (const key of Object.keys(span)) expect(kept.has(key), `${reader.name}: ${key}`).toBe(true);
          read.set(reader.name, (read.get(reader.name) ?? 0) + 1);
        }
      }
    }
    // Every reader read some fixture, so none of them is left out of this check.
    expect([...read.keys()].sort()).toEqual([...TRACE_READERS.keys()].sort());
    expect([...read.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(60);
  });
});

describe('the shapes every reader keeps with --shapes (P113)', () => {
  it('hold no planted value, and no key that is a value, from any fixture body', () => {
    const KEY_NAMES = new Set(['memo', 'password']);
    let read = 0;
    for (const reader of TRACE_READERS.values()) {
      for (const document of documents.filter((one) => reader.sniff(one))) {
        const service = reader.name === 'har' ? 'web' : undefined;
        // Every origin is a service of the map, so no HAR call is a third party's and every body is read.
        const frontEnd = () => ({ frontEnds: ['web'], serviceAt: () => 'gateway' });
        const result = reader.read(document, service, { workflow: 'w', function: 'f', shapes: true, frontEnd });
        if (reader.carriesBodies !== true) {
          expect(result.bodies ?? [], reader.name).toEqual([]);
          continue;
        }
        const text = JSON.stringify(result);
        read += result.bodies?.length ?? 0;
        for (const value of [...PLANTED.filter((one) => !KEY_NAMES.has(one)), ...BODY_VALUES]) expect(text, `${reader.name}: ${value}`).not.toContain(value);
        // A shape holds counts of bodies and nothing else numeric: no length, no value.
        for (const count of JSON.stringify(result.bodies).match(/"n":\d+/g) ?? []) expect(count).toBe('"n":1');
      }
    }
    expect(read).toBeGreaterThan(5);
  });
});
