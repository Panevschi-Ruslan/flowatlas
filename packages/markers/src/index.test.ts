import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  CallsService,
  Consumes,
  ContractIgnore,
  Emits,
  FlowEntry,
  MARKER_NAMES,
  isMarkerName,
} from './index.js';

const factories = {
  Emits: () => Emits('order.created'),
  Consumes: () => Consumes('order.created'),
  CallsService: () => CallsService('billing', 'POST /invoices'),
  FlowEntry: () => FlowEntry('checkout'),
  ContractIgnore: () => ContractIgnore(),
} as const;

describe('markers', () => {
  it('exposes one factory per declared name', () => {
    expect(Object.keys(factories).sort()).toEqual([...MARKER_NAMES].sort());
  });

  it('recognises its own names and nothing else', () => {
    for (const name of MARKER_NAMES) expect(isMarkerName(name)).toBe(true);
    expect(isMarkerName('Injectable')).toBe(false);
  });

  it.each(Object.entries(factories))('%s returns a decorator', (_name, make) => {
    expect(typeof make()).toBe('function');
  });

  it.each(Object.entries(factories))('%s does nothing when applied', (_name, make) => {
    const target = { value: 1 };
    const descriptor = { value: () => 'original' };
    expect(make()(target, 'value', descriptor)).toBeUndefined();
    expect(target).toEqual({ value: 1 });
    expect(descriptor.value()).toBe('original');
  });

  it('has no runtime dependencies', () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
