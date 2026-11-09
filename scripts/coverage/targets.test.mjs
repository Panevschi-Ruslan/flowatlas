import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byRepository } from './figures.mjs';
import { renderReport } from './report.mjs';
import {
  TargetError,
  inTarget,
  pinRepository,
  readRootsOf,
  repositoriesOf,
  typesOf,
  unpinnedOf,
} from './targets.mjs';

const single = {
  name: 'shop',
  repository: 'example/shop',
  commit: 'aaa',
  read: ['apps/web', 'apps/api'],
  types: { 'apps/api': 'nestjs' },
  why: 'one repository',
};

const system = {
  name: 'bookshop',
  repositories: [
    { name: 'storefront', repository: 'example/storefront', commit: 'bbb', read: ['.'] },
    { name: 'catalog', repository: 'example/catalog', commit: null, read: ['.', 'api'], types: { api: 'express' } },
  ],
  why: 'a front end and a back end in two repositories',
};

test('a target of one repository is one repository at the target\'s directory', () => {
  const [repo] = repositoriesOf(single);
  assert.equal(repo.dir, '.');
  assert.deepEqual(readRootsOf(single), ['apps/web', 'apps/api']);
  assert.deepEqual(typesOf(single), { 'apps/api': 'nestjs' });
  assert.equal(inTarget(repo, 'apps/web/src/a.ts'), 'apps/web/src/a.ts');
  assert.deepEqual(unpinnedOf(single), []);
});

test('a target of several repositories reads each under its own directory', () => {
  assert.deepEqual(
    repositoriesOf(system).map((repo) => repo.dir),
    ['storefront', 'catalog'],
  );
  assert.deepEqual(readRootsOf(system), ['storefront', 'catalog', 'catalog/api']);
  assert.deepEqual(typesOf(system), { 'catalog/api': 'express' });
  assert.deepEqual(unpinnedOf(system), ['bookshop/catalog']);
});

test('--pin writes each repository\'s commit back where it came from', () => {
  const copy = structuredClone(system);
  const [, catalog] = repositoriesOf(copy);
  pinRepository(copy, catalog, 'ccc');
  assert.equal(copy.repositories[1].commit, 'ccc');
  const one = structuredClone(single);
  pinRepository(one, repositoriesOf(one)[0], 'ddd');
  assert.equal(one.commit, 'ddd');
});

test('a list of repositories that would clone two into one place, or outside, is refused', () => {
  const twice = { name: 't', repositories: [{ name: 'a', read: ['.'] }, { name: 'a', read: ['.'] }] };
  assert.throws(() => repositoriesOf(twice), TargetError);
  const outside = { name: 't', repositories: [{ name: '../a', read: ['.'] }] };
  assert.throws(() => repositoriesOf(outside), /one plain directory name/);
  const nothing = { name: 't', repositories: [{ name: 'a', read: [] }] };
  assert.throws(() => repositoriesOf(nothing), /reads nothing/);
});

/** A storefront that calls the catalog, and a catalog that tells the storefront something. */
const graph = {
  nodes: [
    { id: 'entry:catalog:http:GET:/books', type: 'entry', kind: 'http', repo: 'catalog' },
    { id: 'entry:storefront:http:GET:/', type: 'entry', kind: 'http', repo: 'storefront' },
    { id: 'ui_api_call:storefront#src/a.ts:1:1', type: 'ui_api_call', repo: 'storefront' },
    { id: 'ui_api_call:storefront#src/a.ts:2:1', type: 'ui_api_call', repo: 'storefront' },
    { id: 'ui_api_call:storefront#src/a.ts:3:1', type: 'ui_api_call', repo: 'storefront' },
    { id: 'producer:catalog#src/p.ts:1:1', type: 'producer', repo: 'catalog' },
    { id: 'channel:book.added', type: 'channel', repo: 'catalog' },
    { id: 'consumer:storefront#src/c.ts:C.on', type: 'consumer', repo: 'storefront' },
  ],
  edges: [
    { from: 'ui_api_call:storefront#src/a.ts:1:1', to: 'entry:catalog:http:GET:/books', type: 'hits' },
    { from: 'ui_api_call:storefront#src/a.ts:2:1', to: 'entry:storefront:http:GET:/', type: 'hits' },
    { from: 'producer:catalog#src/p.ts:1:1', to: 'channel:book.added', type: 'emits' },
    { from: 'channel:book.added', to: 'consumer:storefront#src/c.ts:C.on', type: 'consumes' },
  ],
};

const services = [
  { name: 'storefront', repo: 'storefront', type: 'react', guessed: 'react' },
  { name: 'catalog', repo: 'catalog', type: 'express', guessed: 'express' },
];

test('each repository says how much of what it sends lands in another one', () => {
  const rows = byRepository({ graph, services, dirs: ['storefront', 'catalog'] });
  assert.deepEqual(rows, [
    { dir: 'storefront', services: ['storefront'], waysIn: 1, requests: 3, joined: 2, joinedElsewhere: 1, messages: 0, messagesElsewhere: 0 },
    { dir: 'catalog', services: ['catalog'], waysIn: 1, requests: 0, joined: 0, joinedElsewhere: 0, messages: 1, messagesElsewhere: 1 },
  ]);
});

/** The smallest result a report renders from, with a graph's figures. */
const result = (target, extra = {}) => ({
  target,
  state: 'fresh',
  version: '0.0.0',
  services,
  installs: [],
  steps: {
    link: { code: 0, signal: null },
    build: { code: 0, signal: null, seconds: 1, peakBytes: null, message: null },
    doctor: { code: 0, signal: null },
  },
  truth: {
    files: 2,
    sites: {},
    families: { routes: 1, requests: 1 },
    extent: [],
  },
  figures: {
    routes: { byKind: {}, addresses: 0, duplicated: 0, collided: 0, withBody: 0, reaching: 0, guarded: 0 },
    requests: { browser: { found: 0, joined: 0 }, service: { found: 0, joined: 0 } },
    channels: { found: 0, bothEnds: 0 },
    data: { queries: 0, named: 0, tables: 0 },
    screens: { components: 0, clicks: 0, actions: 0 },
  },
  ...extra,
});

test('a report of one repository gains no section of either kind', () => {
  const text = renderReport(result(single));
  assert.match(text, /\| repository \| `example\/shop` \|/);
  assert.match(text, /\| commit \| `aaa` \|/);
  assert.doesNotMatch(text, /Across repositories|Against the hand labels/);
});

test('a report of several repositories names each with its commit, and a row per repository', () => {
  const pinned = structuredClone(system);
  pinned.repositories[1].commit = 'ccc';
  const text = renderReport(
    result(pinned, {
      truth: {
        files: 2,
        sites: {},
        families: { routes: 1, requests: 1 },
        extent: [],
        repositories: [
          { dir: 'storefront', files: 1, families: {} },
          { dir: 'catalog', files: 1, families: { routes: 1 } },
        ],
      },
      repositories: byRepository({ graph, services, dirs: ['storefront', 'catalog'] }),
    }),
  );
  assert.match(text, /\| repository `storefront` \| `example\/storefront` at `bbb` \|/);
  assert.match(text, /\| repository `catalog` \| `example\/catalog` at `ccc` \|/);
  assert.match(text, /\| read \| `storefront`, `catalog`, `catalog\/api` \|/);
  assert.match(text, /## Across repositories/);
  assert.match(text, /\| `storefront` \| `storefront` \| 1 \| 1 \| 0 \| 3 \| 2 \| 1 \| 0 \| 0 \|/);
  assert.match(text, /\| `catalog` \| `catalog` \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 1 \| 1 \|/);
});

test('the hand labels are a table by kind and a list of every label that was not right', () => {
  const labels = {
    file: 'scripts/coverage/labels/shop.json',
    rows: [
      { file: 'a.ts', line: 3, kind: 'browser', expect: 'http POST /cart', outcome: 'wrong', got: 'http GET /cart' },
      { file: 'b.ts', line: 9, movedFrom: 7, kind: 'browser', expect: 'http GET /cart', outcome: 'missed', got: 'a row: url-dynamic' },
      { file: 'c.ts', line: 1, kind: 'producer', expect: 'channel mail', job: 'welcome', outcome: 'drifted', got: 'the file is not in the clone' },
    ],
    byKind: [
      { kind: 'browser', labels: 2, right: 0, ambiguous: 0, wrong: 1, missed: 1, falsely: 0, drifted: 0, precision: 0, recall: 0 },
      { kind: 'producer', labels: 1, right: 0, ambiguous: 0, wrong: 0, missed: 0, falsely: 0, drifted: 1, precision: null, recall: null },
    ],
    total: { labels: 3, right: 0, ambiguous: 0, wrong: 1, missed: 1, falsely: 0, drifted: 1, precision: 0, recall: 0 },
  };
  const text = renderReport(result(single, { labels }));
  assert.match(text, /## Against the hand labels/);
  assert.match(text, /\| browser \| 2 \| 0 \| 0 \| 1 \| 1 \| 0 \| 0 \| 0% \| 0% \|/);
  assert.match(text, /\| producer \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \| 1 \| n\/a \| n\/a \|/);
  assert.match(text, /### Wrong\n\n\| site \| kind \| expected \| got \|/);
  assert.match(text, /\| `a\.ts:3` \| browser \| `http POST \/cart` \| http GET \/cart \|/);
  assert.match(text, /\| `b\.ts:9` \(labelled at 7\) \|/);
  assert.match(text, /### Site not found\n\n.*\n.*\n\| `c\.ts:1` \| producer \| `channel mail \(job welcome\)` \|/);
});
