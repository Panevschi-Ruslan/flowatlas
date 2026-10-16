import { describe, expect, it } from 'vitest';
import { collectPackageUses, exportKindOf, starterShape, type ModuleUses } from './package-uses.js';

const SOURCE = [
  "import { FlagClient, isOn } from '@acme/flags';",
  "import * as money from '@acme/money';",
  "import queue from '@acme/queue';",
  "import type { Plan } from '@acme/flags/plans';",
  "import { local } from './local';",
  '',
  'export class Fees {',
  '  private readonly flags = new FlagClient();',
  '  constructor(private readonly other: FlagClient) {}',
  '  fee(plan: Plan): string {',
  "    if (isOn('fast')) this.other.reset();",
  "    const chosen = this.flags.variant('fee');",
  '    queue.publish(chosen.level);',
  '    return money.formatAmount(this.flags.limit, money.EUR);',
  '  }',
  '}',
  '',
].join('\n');

const usesOf = (text: string): Map<string, ModuleUses> => {
  const into = new Map<string, ModuleUses>();
  collectPackageUses('/repo/src/fees.ts', text, new Set(['@acme/flags', '@acme/money', '@acme/queue']), into);
  return into;
};

describe('collectPackageUses', () => {
  it('lists the names imported and what is read off each, by name only', () => {
    const uses = usesOf(SOURCE);
    expect([...uses.keys()].sort()).toEqual(['@acme/flags', '@acme/flags/plans', '@acme/money', '@acme/queue']);
    const flags = uses.get('@acme/flags')?.exports;
    const client = flags?.get('FlagClient');
    expect(client?.constructed).toBe(true);
    expect([...(client?.members.keys() ?? [])].sort()).toEqual(['limit', 'reset', 'variant']);
    expect(client?.members.get('variant')?.called).toBe(true);
    expect(client?.members.get('limit')?.called).toBe(false);
    expect(flags?.get('isOn')?.called).toBe(true);
    expect(uses.get('@acme/flags/plans')?.exports.get('Plan')?.typed).toBe(true);
    const money = uses.get('@acme/money')?.exports;
    expect(money?.get('formatAmount')?.called).toBe(true);
    expect(money?.get('EUR')?.valued).toBe(true);
    expect(uses.get('@acme/queue')?.exports.get('default')?.statics.get('publish')?.called).toBe(true);
  });

  it('skips a file that names none of the packages without parsing it', () => {
    expect(usesOf("import { x } from 'elsewhere';\nx();\n").size).toBe(0);
  });
});

describe('starterShape', () => {
  it('declares each name as it is used, every type any, and copies no code', () => {
    const uses = usesOf(SOURCE);
    const text = starterShape([uses.get('@acme/flags') as ModuleUses, uses.get('@acme/queue') as ModuleUses], { header: ['starter'] });
    expect(text).toContain("declare module '@acme/flags' {");
    expect(text).toContain('  export class FlagClient {');
    expect(text).toContain('    variant(...args: any[]): any;');
    expect(text).toContain('    limit: any;');
    expect(text).toContain('  export function isOn(...args: any[]): any;');
    expect(text).toContain('  export const _default: {');
    expect(text).toContain('  export default _default;');
    expect(text).not.toContain("'fast'");
    expect(text).not.toContain('fee');
    expect(text.startsWith('// starter\n')).toBe(true);
  });

  it('gives a name as many type parameters as the project writes it with', () => {
    const uses = usesOf("import { Event, Relation } from '@acme/flags';\nexport const e: Event<'a', number> = new Event<'a', number>();\nexport type R = Relation<string>;\n");
    const text = starterShape([uses.get('@acme/flags') as ModuleUses]);
    expect(text).toContain('  export class Event<T0 = any, T1 = any> {');
    expect(text).toContain('  export type Relation<T0 = any> = any;');
  });

  it('tells a class from a function, a value and a type', () => {
    const uses = usesOf(SOURCE);
    const flags = uses.get('@acme/flags')?.exports;
    expect(exportKindOf(flags?.get('FlagClient') as never)).toBe('class');
    expect(exportKindOf(flags?.get('isOn') as never)).toBe('function');
    expect(exportKindOf(uses.get('@acme/flags/plans')?.exports.get('Plan') as never)).toBe('type');
    expect(exportKindOf(uses.get('@acme/money')?.exports.get('EUR') as never)).toBe('value');
  });
});
