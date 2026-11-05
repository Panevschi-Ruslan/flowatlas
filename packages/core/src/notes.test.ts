import { describe, expect, it } from 'vitest';
import { attachNotes, leadingNotes, MAX_NOTE_CHARS } from './notes.js';

const at = (text: string, marker: string): number => text.split('\n').findIndex((line) => line.includes(marker)) + 1;

describe('what a comment above a declaration says about why (P234)', () => {
  it('keeps a tagged comment, over the decorators between it and the declaration, its lines joined', () => {
    const text = [
      'export class OrdersController {',
      '  // WHY: an order is created once per key;',
      '  // a retry returns the first one.',
      "  @Post('orders')",
      '  @HttpCode(201)',
      '  create() {}',
      '}',
    ].join('\n');
    expect(leadingNotes(text, at(text, 'create()'))).toEqual(['WHY: an order is created once per key; a retry returns the first one.']);
  });

  it('reads a doc comment, its tags apart, and an @see as SEE', () => {
    const text = ['/**', ' * Ships an order.', ' * DECISION: carriers are chosen by weight, not price.', ' * @see docs/adr/0003-carriers.md', ' */', 'export function ship() {}'].join('\n');
    expect(leadingNotes(text, at(text, 'ship()'))).toEqual(['DECISION: carriers are chosen by weight, not price.', 'SEE: docs/adr/0003-carriers.md']);
  });

  it('keeps nothing of an untagged comment, of a comment a blank line away, or of one inside a body', () => {
    const text = ['// The handler.', 'function a() {}', '', '// WHY: far away', '', 'function b() {', '  // WHY: about a line', '  return 1;', '}'].join('\n');
    expect(leadingNotes(text, at(text, 'function a'))).toEqual([]);
    expect(leadingNotes(text, at(text, 'function b'))).toEqual([]);
  });

  it('takes only the tags asked for, three at most, each cut to its limit', () => {
    const long = 'x'.repeat(MAX_NOTE_CHARS + 50);
    const text = ['// WHY: one', '// NOTE: two', `// HACK: ${long}`, '// DECISION: four', 'function f() {}'].join('\n');
    const notes = leadingNotes(text, at(text, 'function f'));
    expect(notes).toHaveLength(3);
    expect(notes[2]).toHaveLength(MAX_NOTE_CHARS + 'HACK: '.length);
    expect(leadingNotes(text, at(text, 'function f'), ['WHY'])).toEqual(['WHY: one']);
  });

  it('puts the notes on declaration nodes, reading each file once, and never on a call site', () => {
    const text = '// WHY: kept\nfunction f() {}\n';
    let reads = 0;
    const nodes = [
      { type: 'function', file: 'a.ts', line: 2 },
      { type: 'method', file: 'a.ts', line: 2 },
      { type: 'http_out', file: 'a.ts', line: 2 },
    ] as Array<{ type: string; file: string; line: number; meta?: Record<string, unknown> }>;
    attachNotes(nodes, () => {
      reads += 1;
      return text;
    });
    expect(reads).toBe(1);
    expect(nodes.map((node) => node.meta?.['notes'])).toEqual([['WHY: kept'], ['WHY: kept'], undefined]);
  });
});
