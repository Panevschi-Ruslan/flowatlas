import { describe, expect, it } from 'vitest';
import { objectBindingsOf, readWorkerDocument, readWorkerToml } from './worker-config.js';

/** The per-scope objects a worker's configuration binds, in each spelling of the file (P361). */
describe('a worker configuration\'s per-scope objects', () => {
  const expected = [
    { binding: 'ROOMS', className: 'Room', file: 'wrangler' },
    { binding: 'LEDGER', className: 'Ledger', scriptName: 'ledger-worker', file: 'wrangler' },
    { binding: 'ROOMS', className: 'StagingRoom', environment: 'staging', file: 'wrangler' },
  ];

  it('reads them from JSON with comments and trailing commas, per environment', () => {
    const document = readWorkerDocument(
      [
        '{',
        '  // bound by name',
        '  "durable_objects": { "bindings": [',
        '    { "name": "ROOMS", "class_name": "Room" },',
        '    { "name": "LEDGER", "class_name": "Ledger", "script_name": "ledger-worker" },',
        '  ] },',
        '  "env": { "staging": { "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "StagingRoom" }] } } },',
        '}',
      ].join('\n'),
      'wrangler.jsonc',
    );
    expect(objectBindingsOf(document ?? {}, 'wrangler')).toEqual(expected);
  });

  it('reads them from TOML as arrays of tables, and as an inline array written over several lines', () => {
    const tables = readWorkerToml(
      [
        '[[durable_objects.bindings]]',
        'name = "ROOMS"',
        'class_name = "Room"',
        '[[durable_objects.bindings]]',
        'name = "LEDGER"',
        'class_name = "Ledger"',
        'script_name = "ledger-worker"',
        '[[migrations]]',
        'tag = "v1"',
        '[[env.staging.durable_objects.bindings]]',
        'name = "ROOMS"',
        'class_name = "StagingRoom"',
      ].join('\n'),
    );
    expect(objectBindingsOf(tables, 'wrangler')).toEqual(expected);
    const inline = readWorkerToml(
      [
        '[durable_objects]',
        'bindings = [',
        '  { name = "ROOMS", class_name = "Room" },  # the rooms',
        '  { name = "LEDGER", class_name = "Ledger", script_name = "ledger-worker" },',
        ']',
        '[env.staging]',
        'durable_objects.bindings = [{ name = "ROOMS", class_name = "StagingRoom" }]',
      ].join('\n'),
    );
    expect(objectBindingsOf(inline, 'wrangler')).toEqual(expected);
  });

  it('keeps a binding only when its name and class are written out', () => {
    const document = readWorkerDocument(JSON.stringify({ durable_objects: { bindings: [{ name: 'ROOMS' }, { name: 'X', class_name: '${CLASS}' }] } }), 'wrangler.json');
    expect(objectBindingsOf(document ?? {}, 'wrangler')).toEqual([]);
  });
});
