/**
 * Hand-built reports for the SARIF tests (P115): one of each kind a log is
 * written from, small enough to read at a glance. Test-only; nothing in the
 * command imports it.
 */
import type { ContractFinding } from '@flowatlas/contracts';
import type { GraphNode } from '@flowatlas/core';
import type { RuleUnchecked, RuleViolation } from '@flowatlas/linker';
import type { Cycle } from '../analysis/scc.js';
import type { DoctorReport } from '../doctor/schema.js';
import type { NodeLookup } from './places.js';
import type { SarifPaths } from './types.js';

export const PATHS: SarifPaths = {
  repoDirs: new Map([
    ['shop', 'shop'],
    ['catalog', 'services/catalog'],
  ]),
  configFile: 'flowatlas.config.json',
  serviceLine: (service) => ({ shop: 4, catalog: 9 })[service],
  ruleLine: (rule) => ({ 'shop-stays-out': 21 })[rule],
  rootDir: '/work/project',
};

const NODES: GraphNode[] = [
  { id: 'shop#src/cart.client.ts:CartClient.add', type: 'method', label: 'CartClient.add', repo: 'shop', file: 'src/cart.client.ts', line: 12 },
  { id: 'catalog#src/items.controller.ts:ItemsController.add', type: 'method', label: 'ItemsController.add', repo: 'catalog', file: 'src/items.controller.ts', line: 30 },
  { id: 'entry:catalog:http:POST:/items', type: 'entry', label: 'POST /items', repo: 'catalog', file: 'src/items.controller.ts', line: 29 },
  { id: 'http_out:shop#src/cart.client.ts:14:5', type: 'http_out', label: 'POST /items', repo: 'shop', file: 'src/cart.client.ts', line: 14 },
  { id: 'channel:item.added', type: 'channel', label: 'item.added', repo: 'catalog' },
] as GraphNode[];

export const LOOKUP: NodeLookup = (() => {
  const byId = new Map(NODES.map((node) => [node.id, node]));
  return { node: (id) => byId.get(id) };
})();

/** A contract error between two services: the shop sends no `sku`, the catalog needs one. */
export const contractError = (overrides: Partial<ContractFinding> = {}): ContractFinding => ({
  severity: 'error',
  kind: 'missing_required',
  edge: { from: 'http_out:shop#src/cart.client.ts:14:5', to: 'entry:catalog:http:POST:/items', type: 'http_calls' },
  edgeKey: 'http_out:shop#src/cart.client.ts:14:5|http_calls|entry:catalog:http:POST:/items',
  direction: 'request',
  sender: { service: 'shop', typeId: 'type:shop#AddItem', symbol: 'shop#src/cart.client.ts:CartClient.add' },
  receiver: { service: 'catalog', typeId: 'type:catalog#AddItem', symbol: 'catalog#src/items.controller.ts:ItemsController.add' },
  typeId: 'type:catalog#AddItem',
  field: 'sku',
  expected: 'string',
  actual: null,
  rule: null,
  message: 'receiver catalog requires `sku: string`; sender shop does not send it',
  ignored: false,
  ignoredBy: null,
  ...overrides,
});

export const violation = (overrides: Partial<RuleViolation> = {}): RuleViolation => ({
  rule: 'shop-stays-out',
  shape: 'forbid',
  severity: 'error',
  note: 'the shop asks the gateway',
  key: 'rule|shop-stays-out|http_out:shop#src/cart.client.ts~POST /items|entry:catalog:http:POST:/items',
  from: 'http_out:shop#src/cart.client.ts:14:5',
  to: 'entry:catalog:http:POST:/items',
  fromService: 'shop',
  toService: 'catalog',
  via: 'http_calls',
  path: [
    { from: 'shop#src/cart.client.ts:CartClient.add', to: 'http_out:shop#src/cart.client.ts:14:5', type: 'calls', confidence: 'static' },
    { from: 'http_out:shop#src/cart.client.ts:14:5', to: 'entry:catalog:http:POST:/items', type: 'http_calls', confidence: 'static' },
  ],
  at: { service: 'shop', file: 'src/cart.client.ts', line: 14 },
  confidence: 'static',
  heuristic: false,
  message: 'shop calls catalog POST /items, which the rule forbids',
  ...overrides,
});

export const unchecked: RuleUnchecked = {
  rule: 'shop-stays-out',
  shape: 'forbid',
  severity: 'warning',
  key: 'rule|shop-stays-out|unchecked|to',
  reason: 'rule-matches-nothing',
  side: 'to',
  selector: 'service catalgo',
  message: 'not checked (to): service "catalgo" names nothing in this graph',
};

export const cycle: Cycle = {
  id: 'shop#src/cart.client.ts:CartClient.add',
  length: 3,
  crossService: true,
  services: ['catalog', 'shop'],
  confidence: 'static',
  nodes: ['shop#src/cart.client.ts:CartClient.add', 'http_out:shop#src/cart.client.ts:14:5', 'catalog#src/items.controller.ts:ItemsController.add'],
  edges: [
    { from: 'shop#src/cart.client.ts:CartClient.add', to: 'http_out:shop#src/cart.client.ts:14:5', type: 'calls', confidence: 'static' },
    { from: 'http_out:shop#src/cart.client.ts:14:5', to: 'catalog#src/items.controller.ts:ItemsController.add', type: 'http_calls', confidence: 'static' },
    { from: 'catalog#src/items.controller.ts:ItemsController.add', to: 'shop#src/cart.client.ts:CartClient.add', type: 'http_calls', confidence: 'heuristic' },
  ],
};

/** A doctor report with nothing in it; a test fills the sections it is about. */
export const emptyDoctor = (): DoctorReport => ({
  doctorFormatVersion: 2,
  schemaVersion: 1,
  flowatlasVersion: '0.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  strict: false,
  baselinePath: null,
  sections: ['unresolved', 'markers', 'desync', 'contracts', 'rules', 'baseline'],
  note: null,
  unresolved: {
    status: 'ok',
    total: 0,
    rows: 0,
    sites: 0,
    notes: 0,
    findings: 0,
    info: { rows: 0, sites: 0 },
    nothing: { rows: 0, sites: 0 },
    excluded: { reasons: [], sites: 0 },
    byReason: [],
    unknownReasons: [],
    waysIn: { found: 0, read: 0 },
  },
  markers: { status: 'ok', note: null, errors: 0, warnings: 0, issues: [] },
  desync: { status: 'ok', rows: [] },
  contracts: { status: 'ok', note: null, errors: [], errorCount: 0, ignored: 0, unchecked: 0 },
  rules: {
    status: 'skipped',
    note: null,
    configured: 0,
    errors: 0,
    warnings: 0,
    infos: 0,
    new: 0,
    failing: 0,
    heuristic: 0,
    excused: 0,
    violations: [],
    unchecked: [],
    notes: [],
  },
  baseline: {
    status: 'skipped',
    note: null,
    total: { baseline: 0, current: 0, delta: 0 },
    byReason: [],
    newKeys: [],
    goneKeys: [],
  },
  verdict: { exitCode: 0, reasons: [] },
});
