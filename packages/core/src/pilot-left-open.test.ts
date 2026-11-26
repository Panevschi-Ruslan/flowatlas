import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readFields, type FieldsRead } from './field-reads.js';
import type { FunctionLike } from './types/signatures.js';

/**
 * A dispatcher's reads through a cast (P405): the message handed over as text
 * and parsed, held in a local made by a cast, each read under the case it is
 * written in, and whether a read is checked first and what the code does
 * without the field.
 */
const read = (text: string, name: string, param = 0, guards = true): FieldsRead => {
  const file = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } }).createSourceFile('a.ts', text);
  const fn =
    file.getFunction(name) ??
    file
      .getClasses()
      .flatMap((each) => each.getMethods())
      .find((method) => `${(method.getParent() as { getName(): string }).getName()}.${method.getName()}` === name);
  if (fn === undefined) throw new Error(`no ${name}`);
  const idOf = (each: FunctionLike): string | undefined => {
    if (Node.isMethodDeclaration(each)) return `${(each.getParent() as { getName(): string }).getName()}.${each.getName()}`;
    if (Node.isFunctionDeclaration(each)) return each.getName();
    return undefined;
  };
  return readFields(fn, [{ param, state: { kind: 'payload', prefix: [] } }], { idOf, isOwn: () => true, ...(guards ? { guards: true } : {}) });
};

/** The rows as `field@in:line[when] guarded/exit`, short to compare. */
const said = (found: FieldsRead): string[] =>
  found.reads.map(
    (row) =>
      `${row.field}${row.in === undefined ? '' : `@${row.in}`}:${row.line}${row.when === undefined ? '' : `[${row.when.join('|')}]`}` +
      `${row.guarded === true ? ' guarded' : ''}${row.whenAbsent === undefined ? '' : ` ${row.whenAbsent}`}`,
  );

const DISPATCH = [
  'declare function formatCall(input: { scopeId: string; roomId: string; calledAt: string }): string;',
  'class Push {',
  '  onEvent(raw: string) {',
  '    const evt = JSON.parse(raw) as { type: string; scopeId: string };',
  '    void this.dispatch(evt.scopeId, evt);',
  '  }',
  '  async dispatch(scopeId: string, raw: unknown) {',
  '    const evt = raw as { type: string; roomId?: string; ts?: string; orderId?: string };',
  '    const first = evt.orderId;',
  '    switch (evt.type) {',
  "      case 'CALL_STAFF': {",
  '        if (!evt.roomId) return;',
  '        return formatCall({ scopeId, roomId: evt.roomId, calledAt: evt.ts ?? first ?? "" });',
  '      }',
  "      case 'STEP_READY':",
  '        if (evt.roomId === undefined) throw new Error("no room");',
  '        return evt.roomId;',
  '    }',
  '  }',
  '}',
].join('\n');

describe('a dispatcher read through a cast (P405)', () => {
  it('reads a message parsed from text, on into the function it is handed to', () => {
    const found = read(DISPATCH, 'Push.onEvent');
    expect(said(found)).toEqual([
      'scopeId:5',
      'orderId@Push.dispatch:9',
      'type@Push.dispatch:10',
      'roomId@Push.dispatch:12[CALL_STAFF] guarded returns',
      'roomId@Push.dispatch:13[CALL_STAFF] guarded returns',
      'ts@Push.dispatch:13[CALL_STAFF] guarded',
      'roomId@Push.dispatch:16[STEP_READY] guarded throws',
      'roomId@Push.dispatch:17[STEP_READY] guarded throws',
    ]);
    expect(found.unread).toEqual([]);
  });

  it('holds the message in a local made by a cast: a read before the switch under every type, one in a case under its type', () => {
    expect(said(read(DISPATCH, 'Push.dispatch', 1))).toEqual([
      'orderId:9',
      'type:10',
      'roomId:12[CALL_STAFF] guarded returns',
      'roomId:13[CALL_STAFF] guarded returns',
      'ts:13[CALL_STAFF] guarded',
      'roomId:16[STEP_READY] guarded throws',
      'roomId:17[STEP_READY] guarded throws',
    ]);
  });

  it('says no exit for a check in another branch, nor for a check that does not leave', () => {
    const found = read(
      [
        'function handle(evt: { type: string; a?: string; b?: string }) {',
        "  if (evt.type === 'X') {",
        '    if (!evt.a) return;',
        '  }',
        '  if (evt.b) console.log(evt.b);',
        '  return evt.a;',
        '}',
      ].join('\n'),
      'handle',
    );
    expect(said(found).filter((row) => !row.startsWith('type'))).toEqual(['a:3[X] guarded returns', 'b:5 guarded', 'a:6 guarded']);
  });

  it('marks nothing guarded where guards are not asked for', () => {
    expect(said(read(DISPATCH, 'Push.dispatch', 1, false))).toEqual(['orderId:9', 'type:10', 'roomId:12[CALL_STAFF]', 'roomId:13[CALL_STAFF]', 'ts:13[CALL_STAFF]', 'roomId:16[STEP_READY]', 'roomId:17[STEP_READY]']);
  });
});
