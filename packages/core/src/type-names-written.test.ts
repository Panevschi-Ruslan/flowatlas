import { describe, expect, it } from 'vitest';
import { nameWrittenOf, testMayTake, typeNamesIn } from './type-names-written.js';

/**
 * Where a type's name is written (P404): each place said as a message built,
 * a definition, a type, an import or anything else, and every test of a
 * string the name cannot rule out.
 */
const kinds = (text: string, words: string[], file = 'a.ts'): Array<[number, string, string?, string?]> =>
  typeNamesIn(file, text, new Set(words), { tests: false }).sites.map((site) => [site.line, site.kind, site.alias, site.container]);

describe('where a type name is written', () => {
  it('says a message built, a definition with the name it is held by, a type and an import apart from a choice', () => {
    const text = [
      "import { ROW_CLAIMED } from './names';", // 1
      "export enum VenueEvent { Claimed = 'ROW_CLAIMED' }", // 2
      "export const Names = { ROW_CLAIMED: 'ROW_CLAIMED' } as const;", // 3
      "interface Claimed { type: 'ROW_CLAIMED' }", // 4
      "bus.publish('ch', { type: 'ROW_CLAIMED', id });", // 5
      "msg.type = Names.ROW_CLAIMED;", // 6
      "switch (evt.type) { case 'ROW_CLAIMED': break; }", // 7
      "if (evt.type === 'ROW_CLAIMED') go();", // 8
      "const handlers = { ROW_CLAIMED: (e) => go(e) };", // 9
    ].join('\n');
    expect(kinds(text, ['ROW_CLAIMED'])).toEqual([
      [1, 'import', undefined, undefined],
      [2, 'definition', 'Claimed', 'VenueEvent'],
      [3, 'definition', undefined, 'Names'],
      [3, 'definition', undefined, 'Names'],
      [4, 'type', undefined, undefined],
      [5, 'write', undefined, undefined],
      [6, 'write', undefined, undefined],
      [7, 'other', undefined, undefined],
      [8, 'other', undefined, undefined],
      [9, 'other', undefined, undefined],
    ]);
  });

  it('says the member a name is read through, and a whole enum used', () => {
    const text = ["send({ type: VenueEvent.Claimed });", 'const all = Object.values(VenueEvent);'].join('\n');
    const sites = typeNamesIn('b.ts', text, new Set(['Claimed', 'VenueEvent']), { tests: false }).sites;
    expect(sites.map((site) => [site.word, site.kind, site.of])).toEqual([
      ['VenueEvent', 'member', undefined],
      ['Claimed', 'write', 'VenueEvent'],
      ['VenueEvent', 'other', undefined],
    ]);
  });

  it('reads a template as text and a single-file component by its script', () => {
    expect(kinds('<div *ngIf="kind === \'ROW_CLAIMED\'"></div>', ['ROW_CLAIMED'], 'a.component.html')).toEqual([[1, 'other', undefined, undefined]]);
    const component = ['<template><p>{{ label }}</p></template>', '<script lang="ts">', "if (evt.type === 'ROW_CLAIMED') go();", '</script>'].join('\n');
    expect(kinds(component, ['ROW_CLAIMED'], 'Row.component')).toEqual([[3, 'other', undefined, undefined]]);
  });

  it('finds the tests a name cannot rule out, and which values each may take', () => {
    const text = [
      "if (evt.type.startsWith('ORDER_')) count();", // 1
      'if (/^ORDER_(PAID|READY)$/.test(evt.type)) count();', // 2
      'if (/^[A-Z_]+$/.test(evt.type)) count();', // 3
      'const name = `ORDER_${state}`;', // 4
      "const url = `/api/${id}/orders`;", // 5
      "if (evt.type.includes('PAID')) count();", // 6
    ].join('\n');
    const tests = typeNamesIn('c.ts', text, new Set()).tests;
    expect(tests.map((test) => [test.line, test.shape.kind])).toEqual([
      [1, 'prefix'],
      [2, 'pattern'],
      [3, 'pattern'],
      [4, 'assembled'],
      [6, 'contains'],
    ]);
    const takes = (value: string): number[] => tests.filter((test) => testMayTake(test.shape, value)).map((test) => test.line);
    expect(takes('ORDER_PAID')).toEqual([1, 2, 4, 6]);
    // A pattern of letters alone checks a shape, not a type; a prefix takes no other name.
    expect(takes('ROW_CLAIMED')).toEqual([]);
  });

  it('reads back what a type node says', () => {
    expect(nameWrittenOf({ meta: {} })).toBeUndefined();
    expect(
      nameWrittenOf({ meta: { nameWritten: { sent: [{ service: 'api', loc: 'a.ts:3', text: 'x' }], sentCount: 1, onlyAtSends: true, defined: 1, open: [], openCount: 0 } } }),
    ).toEqual({ sent: [{ service: 'api', loc: 'a.ts:3', text: 'x' }], sentCount: 1, onlyAtSends: true, defined: 1, open: [], openCount: 0 });
  });
});
