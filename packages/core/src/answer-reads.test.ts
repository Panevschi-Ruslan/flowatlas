import { Node, Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { answerFieldsRead, type AnswerMemberUse, type AnswerStart } from './answer-reads.js';
import type { FieldsRead } from './field-reads.js';
import type { FunctionLike } from './types/signatures.js';

/** A request made where `request(` is called, in a file of its own; its answer followed (P391). */
const read = (
  text: string,
  start: Omit<AnswerStart, 'call'>,
  memberUse?: (owner: string, member: string) => AnswerMemberUse | undefined,
): FieldsRead => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true, jsx: 4 } });
  const file = project.createSourceFile('a.tsx', text);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => /^(?:request|this\.http\.get)$/.test(each.getExpression().getText())) as CallExpression;
  const idOf = (fn: FunctionLike): string | undefined => {
    if (Node.isMethodDeclaration(fn)) return `${(fn.getParent() as { getName(): string }).getName()}.${fn.getName()}`;
    if (Node.isFunctionDeclaration(fn)) return fn.getName();
    const holder = fn.getParent();
    return holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getName() : undefined;
  };
  return answerFieldsRead(
    { call, ...start },
    { idOf, isOwn: () => true, rootId: 'request', ...(memberUse === undefined ? {} : { memberUse: (owner, member) => memberUse(owner.getName() ?? '', member) }) },
  );
};

const said = (found: FieldsRead): string[] => found.reads.map((row) => `${row.field}@${row.in ?? '?'}:${row.line}`);

const PAYLOAD = { comes: 'promise', state: { kind: 'payload', prefix: [] } } as const;
const FETCHED = { comes: 'promise', state: { kind: 'response', bodyKeys: [], bodyCalls: ['json'] } } as const;

describe('answerFieldsRead', () => {
  it('follows a response through await and json(), handed back to a caller that walks the list', () => {
    const found = read(
      [
        'type Order = { id: string; total: number; lines: { sku: string }[] };',
        'declare function request(url: string): Promise<{ json(): Promise<Order[]> }>;',
        'async function load(): Promise<Order[]> {',
        "  const response = await request('/orders');",
        '  return response.json();',
        '}',
        'async function show() {',
        '  const orders = await load();',
        '  const open = orders.filter((order) => order.total > 0);',
        '  return open.map((order) => order.lines.length + order.id.length);',
        '}',
      ].join('\n'),
      FETCHED,
    );
    expect(said(found)).toEqual(['total@show:9', 'id@show:10', 'lines@show:10']);
    expect(found.unread).toEqual([]);
  });

  it("reads axios's data through then, a data hook's data, a row's props and a state's setter", () => {
    const found = read(
      [
        'type Order = { id: string; status: string; note: string };',
        'declare function request(url: string): Promise<{ data: Order[] }>;',
        'declare function useQuery<T>(options: { queryFn: () => Promise<T> }): { data: T | undefined };',
        'declare function useState<T>(initial: T): [T, (next: T) => void];',
        "const listOrders = () => request('/orders').then((response) => response.data);",
        'function Row({ order }: { order: Order }) { return <li>{order.status}</li>; }',
        'function List() {',
        '  const { data } = useQuery({ queryFn: listOrders });',
        '  const [first, setFirst] = useState<Order | undefined>(undefined);',
        '  if (data !== undefined) setFirst(data[0]);',
        '  return <ul>{data?.map((order) => <Row key={order.id} order={order} />)}{first?.note}</ul>;',
        '}',
      ].join('\n'),
      { comes: 'promise', state: { kind: 'response', bodyKeys: ['data'], bodyCalls: [] } },
    );
    expect(said(found).sort()).toEqual(['id@List:11', 'note@List:11', 'status@Row:6']);
  });

  it('follows an observable through pipe and map into a member, its template and a method it is handed to', () => {
    const found = read(
      [
        'type Order = { id: string; customer: { name: string; email: string }; total: number };',
        'declare const rx: { map<A, B>(fn: (a: A) => B): unknown };',
        'class OrderPage {',
        '  order: Order | undefined;',
        '  http = { get: (url: string) => ({ pipe: (op: unknown) => ({ subscribe: (fn: (o: Order) => void) => fn }) }) };',
        '  load() {',
        "    this.http.get('/order').pipe(rx.map((wrapped: { data: Order }) => wrapped.data)).subscribe((order) => { this.order = order; });",
        '  }',
        '  email(order: Order) { return order.customer.email; }',
        '}',
      ].join('\n'),
      { comes: 'observable', state: { kind: 'payload', prefix: [] } },
      (owner, member) =>
        owner === 'OrderPage' && member === 'order'
          ? { in: 'OrderPage', reads: [{ path: ['customer', 'name'], line: 3, file: 'page.html' }], handed: [{ method: 'email', index: 0, path: [] }], bound: [], unread: [] }
          : undefined,
    );
    // Each path is under the answer, so what is read inside its `data` is read as `data.…`.
    expect(said(found)).toEqual(['data.customer.name@OrderPage:3', 'data.customer.email@OrderPage.email:9', 'data@OrderPage.load:7']);
    expect(found.reads.find((row) => row.file !== undefined)?.file).toBe('page.html');
  });

  it('says a use it cannot follow', () => {
    const found = read(
      [
        'type Order = { id: string };',
        'declare function request(url: string): Promise<Order>;',
        'declare function forkJoin(all: unknown[]): unknown;',
        'async function show() {',
        "  const order = await request('/order');",
        '  return JSON.stringify(order);',
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    expect(found.reads).toEqual([]);
    expect(found.unread.map((row) => row.why)).toEqual(['handed to JSON.stringify']);
  });
});
