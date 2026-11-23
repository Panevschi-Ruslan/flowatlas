import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readFields, type FieldsRead, type ValueState } from './field-reads.js';
import type { FunctionLike } from './types/signatures.js';

/** Which fields of what it is handed a function reads (P368), in a file of its own. */
const read = (text: string, name: string, state: ValueState = { kind: 'payload', prefix: [] }, param = 0): FieldsRead => {
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
  return readFields(fn, [{ param, state }], { idOf, isOwn: () => true });
};

/** The rows as `field@in:line[when]`, short to compare. */
const said = (found: FieldsRead): string[] =>
  found.reads.map((row) => `${row.field}${row.in === undefined ? '' : `@${row.in}`}:${row.line}${row.when === undefined ? '' : `[${row.when.join('|')}]`}`);

describe('readFields', () => {
  it('reads members, optional members, string keys and destructuring, in the parameter list too', () => {
    const found = read(
      [
        'type Evt = { a: string; b?: { c: string }; d: string; e: string };',
        'function handle(evt: Evt, { e }: Evt = evt) {',
        "  const { d, b: { c } } = evt;",
        "  return [evt.a, evt?.b?.c, evt['d'], d, c, e];",
        '}',
      ].join('\n'),
      'handle',
    );
    expect(said(found)).toEqual(['b:3', 'b.c:3', 'd:3', 'a:4', 'b.c:4', 'd:4']);
    expect(found.unread).toEqual([]);
  });

  it('follows a local that is the value again, and the value handed to a function of its own', () => {
    const found = read(
      [
        'type Evt = { label?: string; id: string };',
        'function show(item: Evt) { return item.label ?? item.id; }',
        'function handle(raw: unknown) {',
        '  const evt = raw as Evt;',
        '  const name = evt.id;',
        '  return show(evt) + name.trim();',
        '}',
      ].join('\n'),
      'handle',
    );
    expect(said(found)).toEqual(['id:5', 'id@show:2', 'label@show:2']);
  });

  it('writes a read under the type a switch, an if or an early return on the discriminator chooses', () => {
    const found = read(
      [
        "type Evt = { type: string; label?: string; reason?: string; deskId?: number };",
        'class Bot {',
        '  ready(evt: Evt) { return evt.label; }',
        '  route(evt: Evt) {',
        '    switch (evt.type) {',
        "      case 'READY':",
        '        return this.ready(evt);',
        "      case 'GONE':",
        "      case 'CANCELLED':",
        '        return evt.reason;',
        '    }',
        "    if (evt.type === 'HELP') return evt.deskId;",
        "    if (evt.type !== 'PING') return;",
        '    return evt.label;',
        '  }',
        '}',
      ].join('\n'),
      'Bot.route',
    );
    // The function's own reads first, then each function it hands the value to.
    expect(said(found)).toEqual(['type:5', 'reason:10[GONE|CANCELLED]', 'deskId:12[HELP]', 'type:12', 'type:13', 'label:14[PING]', 'label@Bot.ready:3[READY]']);
  });

  it("reads a request's body however it is reached, and nothing else of the request", () => {
    const request: ValueState = { kind: 'request' };
    expect(said(read('function h(req: any) { return req.body.a + req.body?.b + req.headers.c; }', 'h', request))).toEqual(['a:1', 'b:1']);
    expect(said(read('function h(ctx: any) { const { x } = ctx.request.body; return x; }', 'h', request))).toEqual(['x:1']);
    expect(said(read('async function h(c: any) { const body = await c.req.json(); return body.y; }', 'h', request))).toEqual(['y:1']);
    expect(said(read("function h(c: any) { return c.req.valid('json').z; }", 'h', request))).toEqual(['z:1']);
    const guard = read(
      [
        'class Guard {',
        '  canActivate(context: any) {',
        '    const request = context.switchToHttp().getRequest();',
        '    return this.ref(request) !== undefined;',
        '  }',
        '  ref(request: any) { return request.body?.userRef ?? request.headers.ref; }',
        '}',
      ].join('\n'),
      'Guard.canActivate',
      { kind: 'context' },
    );
    expect(said(guard)).toEqual(['userRef@Guard.ref:6']);
  });

  it('says each use it cannot follow, and never a part already read', () => {
    const found = read(
      [
        'declare function send(x: unknown): void;',
        'type Evt = { a: string; b: string };',
        'function h(evt: Evt, key: keyof Evt) {',
        '  send(evt.a);',
        '  const copy = { ...evt };',
        '  const { a, ...rest } = evt;',
        '  for (const k in evt) send(k);',
        '  send(evt);',
        '  return evt[key] + copy.a + rest.b + a;',
        '}',
      ].join('\n'),
      'h',
    );
    expect(found.unread.map((row) => `${row.line} ${row.why}`)).toEqual([
      '5 spread into another value',
      '6 the rest of it gathered into another value',
      '7 its keys walked',
      '8 handed to send',
      '9 indexed by key',
    ]);
  });

  it('reads a key the code holds as a default, and a local assigned the body in one branch of several (P374)', () => {
    const guard = read(
      [
        'type Req = { params: Record<string, unknown>; query: Record<string, unknown>; body?: Record<string, unknown> };',
        "type Opts = { actsAs?: { in: 'param' | 'query' | 'body'; name: string } };",
        'class Guard {',
        '  supplied(req: Req, options: Opts) {',
        "    const source = options.actsAs ?? { in: 'body', name: 'userRef' };",
        '    let bag: Record<string, unknown> | undefined;',
        "    if (source.in === 'param') bag = req.params;",
        "    else if (source.in === 'query') bag = req.query;",
        '    else bag = req.body;',
        '    return bag?.[source.name];',
        '  }',
        '}',
      ].join('\n'),
      'Guard.supplied',
      { kind: 'request' },
    );
    expect(guard.reads).toEqual([{ field: 'userRef', line: 10, sureness: 'default' }]);
    expect(guard.unread).toEqual([]);

    const keys = read(
      [
        'type Evt = Record<string, string>;',
        "const KEY = 'label';",
        "const NAMES = { id: 'orderId' };",
        "function h(evt: Evt, field = 'note') {",
        '  return evt[KEY] + evt[NAMES.id] + evt[field];',
        '}',
      ].join('\n'),
      'h',
    );
    expect(keys.reads.map((row) => `${row.field}${row.sureness === undefined ? '' : ` (${row.sureness})`}`)).toEqual(['label', 'note (default)', 'orderId']);
    expect(keys.unread).toEqual([]);
  });
});
