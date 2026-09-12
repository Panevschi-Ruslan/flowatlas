#!/usr/bin/env node
/**
 * Derives the three baselines this fixture is checked against.
 *
 *   node fixtures/multi-repo-doctor/make-baselines.mjs
 *
 * `baseline.accepted.json` is what `flowatlas doctor --accept` writes here, with
 * the three fields that legitimately differ between two runs replaced by fixed
 * values so the file can be committed. The other two are that file with one
 * thing changed each, so that a strict run over the same graph has exactly one
 * reason to answer differently:
 *
 * - `baseline.smaller.json` accepted one place fewer, so the project has grown
 *   and a strict run must fail.
 * - `baseline.moved.json` accepted the same number of places, one of them in a
 *   file that has since been renamed. The totals agree, the keys do not, and a
 *   strict run must pass while the report names what moved.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const accepted = join(here, 'baseline.accepted.json');

const baseline = JSON.parse(readFileSync(accepted, 'utf8'));

/** What a second run would write differently, pinned so the file can be committed. */
baseline.acceptedAt = '2026-09-09T20:14:00.000Z';
baseline.acceptedBy = 'fixture';
baseline.flowatlasVersion = '0.0.0';
baseline.graph.builtAt = '2026-09-09T20:10:02.000Z';

const write = (name, value) =>
  writeFileSync(join(here, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

write('baseline.accepted.json', baseline);

const clone = () => JSON.parse(JSON.stringify(baseline));

// One place fewer was accepted than the project has: growth, and exit 1.
const smaller = clone();
smaller.unresolved.total -= 1;
smaller.unresolved.byReason['unknown-db-package'] -= 1;
smaller.unresolved.byService.orders -= 1;
const shrunk = smaller.unresolved.keys.find((row) => row.key.endsWith('this.rows.find|unknown-db-package'));
shrunk.count -= 1;
write('baseline.smaller.json', smaller);

// The same number of places, one of them somewhere else: no growth, and a
// report that says which key went and which arrived.
const moved = clone();
const renamed = moved.unresolved.keys.find((row) => row.key.endsWith('AppModule imports HttpModule|module-import-dynamic'));
renamed.key = renamed.key.replace('src/app.module.ts', 'src/application.module.ts');
moved.unresolved.keys.sort((a, b) => (a.key < b.key ? -1 : 1));
write('baseline.moved.json', moved);

console.log('wrote baseline.accepted.json, baseline.smaller.json, baseline.moved.json');
