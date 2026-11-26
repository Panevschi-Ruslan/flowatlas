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

  it("reads a client's data through then, a data hook's data, a row's props and a state's setter", () => {
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

  it('marks a read the code checks for presence first guarded, and leaves a plain read and a check on the answer itself unmarked (P395)', () => {
    const found = read(
      [
        'type Store = { name: string; rating: number; distance?: number; address?: string; changes?: { added: string[] }; tags?: string[]; phone?: string; hours?: string };',
        'declare function request(url: string): Promise<Store>;',
        'function distanceLabel(v: Store): string {',
        '  const m = v.distance;',
        "  if (m == null) return v.address ?? '';",
        '  return `${m} km`;',
        '}',
        'function changeSummary(row: Store): string {',
        '  const d = row.changes;',
        "  if (d) return d.added.join(', ');",
        "  return '';",
        '}',
        'function extra(s: Store): string {',
        "  const tags = s.tags?.join(',');",
        "  const phone = 'phone' in s ? s.phone!.trim() : '';",
        "  return `${tags}${phone}${s.hours ? s.hours : ''}`;",
        '}',
        'async function show(): Promise<string> {',
        "  const store: Store | undefined = await request('/stores/1');",
        '  return `${store?.name}${store!.rating.toFixed(1)}${distanceLabel(store!)}${changeSummary(store!)}${extra(store!)}`;',
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    const guarded = found.reads.filter((row) => row.guarded === true).map((row) => row.field).sort();
    const plain = found.reads.filter((row) => row.guarded !== true).map((row) => row.field).sort();
    expect(guarded).toEqual(['address', 'changes', 'changes.added', 'distance', 'hours', 'phone', 'tags']);
    expect(plain).toEqual(['name', 'rating']);
  });

  it('marks a read through a branch of a ternary or a fallback guarded where the key is asked of its holder (P402)', () => {
    const found = read(
      [
        'type Store = { name: string; phone?: string; meta: { k?: string } };',
        'declare function request(url: string): Promise<Store>;',
        'function phone(s: Store): string { return `${"phone" in s ? s.phone : ""}`; }',
        'function key(s: Store): string { return "k" in s.meta ? s.meta.k ?? "" : ""; }',
        'async function show(): Promise<string> {',
        "  const store = await request('/stores/1');",
        '  return `${store.name}${phone(store)}${key(store)}`;',
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    expect(found.reads.map((row) => `${row.field}${row.guarded === true ? ' guarded' : ''}`).sort()).toEqual(['meta', 'meta.k guarded', 'name', 'phone guarded']);
  });

  it("ties each answer gathered by Promise.all or forkJoin to its own place, and reads nothing of the others' (P402)", () => {
    const promised = read(
      [
        'type Item = { name: string; price: number };',
        'type User = { email: string };',
        'declare function request(url: string): Promise<Item>;',
        'declare function other(url: string): Promise<User>;',
        'async function show(): Promise<string> {',
        "  const [user, item] = await Promise.all([other('/me'), request('/items/1')]);",
        "  const all = await Promise.all([request('/items/2'), other('/me')]);",
        '  return `${user.email}${item.name}${all[1].email}`;',
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    expect(said(promised)).toEqual(['name@show:8']);
    expect(promised.unread).toEqual([]);
    const joined = read(
      [
        'type Item = { name: string; price: number };',
        'type Stats = { views: number };',
        'declare function forkJoin<T>(sources: T): { subscribe(fn: (value: any) => void): void };',
        'class ItemPage {',
        '  http = { get: (url: string) => ({ url }) };',
        '  load() {',
        "    forkJoin({ item: this.http.get('/items/1'), stats: this.other('/stats') }).subscribe(({ item, stats }) => {",
        '      console.log(item.price, stats.views);',
        '    });',
        '  }',
        '  other(url: string) { return { url }; }',
        '}',
      ].join('\n'),
      { comes: 'observable', state: { kind: 'payload', prefix: [] } },
    );
    expect(said(joined)).toEqual(['price@ItemPage.load:8']);
  });

  it('records a switch over a field: no default, a default, or one that proves no value is left (P402)', () => {
    const found = read(
      [
        "type Item = { status: 'draft' | 'live'; kind: 'a' | 'b'; tier: 'x' | 'y' };",
        'declare function request(url: string): Promise<Item>;',
        'declare function assertNever(value: never): never;',
        'async function show(): Promise<string> {',
        "  const item = await request('/items/1');",
        "  switch (item.status) { case 'draft': return 'd'; }",
        '  const kind = item.kind;',
        "  switch (kind) { case 'a': return 'a'; case 'b': return 'b'; default: return assertNever(kind); }",
        "  switch (item.tier) { case 'x': return 'x'; default: return '?'; }",
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    expect(found.reads.map((row) => [row.field, row.switched])).toEqual([
      ['status', { has: 'none', cases: ["'draft'"], line: 6 }],
      ['kind', { has: 'never', cases: ["'a'", "'b'"], line: 8 }],
      ['tier', { has: 'default', cases: ["'x'"], line: 9 }],
    ]);
  });

  it("marks a template's read guarded where the template checks a field on its path, never the member holding the whole answer alone (P402)", () => {
    const found = read(
      [
        'type Item = { name: string; promo?: { text: string } };',
        'class ItemPage {',
        '  item: Item | undefined;',
        '  http = { get: (url: string) => ({ subscribe: (fn: (o: Item) => void) => fn }) };',
        "  load() { this.http.get('/item').subscribe((item) => { this.item = item; }); }",
        '}',
      ].join('\n'),
      { comes: 'observable', state: { kind: 'payload', prefix: [] } },
      (owner, member) =>
        owner === 'ItemPage' && member === 'item'
          ? {
              in: 'ItemPage',
              reads: [
                { path: ['name'], line: 2, file: 'page.html', checked: 0 },
                { path: ['promo', 'text'], line: 3, file: 'page.html', checked: 1 },
              ],
              handed: [],
              bound: [],
              unread: [],
            }
          : undefined,
    );
    expect(found.reads.map((row) => `${row.field}${row.guarded === true ? ' guarded' : ''}`)).toEqual(['name', 'promo.text guarded']);
  });

  it("marks a read inside a component's markup guarded where the markup checks it first (P402)", () => {
    const found = read(
      [
        'type Item = { name: string; promo?: { text: string }; badge?: { label: string } };',
        'declare function request(url: string): Promise<Item>;',
        'declare function useState<T>(initial: T): [T, (next: T) => void];',
        'function ItemCard() {',
        '  const [item, setItem] = useState<Item | undefined>(undefined);',
        "  request('/items/1').then(setItem);",
        '  return <div>{item?.name}{item?.promo && <b>{item.promo.text}</b>}{item?.badge?.label}</div>;',
        '}',
      ].join('\n'),
      PAYLOAD,
    );
    expect(found.reads.map((row) => `${row.field}${row.guarded === true ? ' guarded' : ''}`).sort()).toEqual(['badge.label guarded', 'name', 'promo guarded', 'promo.text guarded']);
  });
});
