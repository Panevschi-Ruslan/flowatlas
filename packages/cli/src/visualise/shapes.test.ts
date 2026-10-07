import type { GraphEdge, GraphNode, TypeEntry } from '@flowatlas/core';
import type { LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import {
  CARD_BOUNDS,
  cardOf,
  createModel,
  faceLine,
  faceOf,
  GLANCE,
  insideOf,
  openAll,
  panelKeysOf,
  peekOf,
  refParts,
  refText,
  TYPE_BOUNDS,
  typeInfo,
  typeScriptOf,
} from './graph.js';
import { packGraph } from './pack.js';
import { prettyRef } from './shapes.js';

const report = {
  httpOut: {},
  channels: {},
  routes: { total: 0, called: 0, duplicated: 0 },
  types: {},
  totals: {},
  services: [],
} as unknown as LinkReport;

const ORDER = 'type:api#Order';
const CREATE = 'type:api#CreateOrder';
const LINE = 'type:api#Line';
const STATUS = 'type:api#Status';
const PAGE = `type:api#Page<${ORDER}>`;

const registry: Record<string, TypeEntry> = {
  [ORDER]: {
    name: 'Order',
    kind: 'object',
    declaredIn: 'api#src/order.ts',
    structuralHash: 'a',
    fields: [
      { name: 'id', type: 'string', optional: false },
      { name: 'lines', type: `${LINE}[]`, optional: false },
      { name: 'status', type: STATUS, optional: false },
      { name: 'parent', type: ORDER, optional: true },
    ],
  },
  [CREATE]: {
    name: 'CreateOrder',
    kind: 'object',
    declaredIn: 'api#src/order.dto.ts',
    structuralHash: 'b',
    fields: [{ name: 'lines', type: `${LINE}[]`, optional: false }],
  },
  [LINE]: {
    name: 'Line',
    kind: 'object',
    declaredIn: 'api#src/order.ts',
    structuralHash: 'c',
    fields: [
      { name: 'sku', type: 'string', optional: false },
      { name: 'qty', type: 'number', optional: false },
    ],
  },
  [STATUS]: {
    name: 'Status',
    kind: 'enum',
    declaredIn: 'api#src/order.ts',
    structuralHash: '',
    members: ['NEW', 'PAID'],
  },
  [PAGE]: {
    name: 'Page',
    kind: 'object',
    declaredIn: 'api#src/page.ts',
    structuralHash: 'd',
    fields: [{ name: 'items', type: `${ORDER}[]`, optional: false }],
  },
  'type:api#Unused': { name: 'Unused', kind: 'object', declaredIn: 'api#src/x.ts', structuralHash: 'e', fields: [] },
};

const nodes: GraphNode[] = [
  /* 0 */ { id: 'entry:api:http:POST:/orders', type: 'entry', kind: 'http', label: 'POST /orders', repo: 'api' },
  /* 1 */ {
    id: 'api#src/orders.controller.ts:OrdersController.create',
    type: 'method',
    label: 'OrdersController.create',
    repo: 'api',
    meta: {
      signature: {
        params: [
          { name: 'dto', type: CREATE },
          { name: 'note', type: 'string', optional: true },
          { name: 'tags', type: 'string[]', rest: true },
        ],
        returns: ORDER,
      },
    },
  },
  /* 2 */ { id: 'api#src/orders.service.ts:OrdersService.list', type: 'method', label: 'OrdersService.list', repo: 'api' },
  /* 3 */ { id: 'http_out:web#src/api.ts:3:1', type: 'http_out', label: 'POST /orders', repo: 'web' },
  /* 4 */ { id: 'channel:orders/created', type: 'channel', label: 'orders/created', repo: 'api' },
  /* 5 */ { id: 'producer:api#src/orders.service.ts:9:1', type: 'producer', label: 'emit orders/created', repo: 'api' },
  /* 6 */ { id: 'api#src/audit.ts:Audit.log', type: 'method', label: 'Audit.log', repo: 'api' },
  /* 7 */ { id: 'table:orders', type: 'table', label: 'orders', repo: 'api' },
];

const edges: GraphEdge[] = [
  {
    from: nodes[0]!.id,
    to: nodes[1]!.id,
    type: 'handles',
    confidence: 'static',
    params: [CREATE, 'string', 'string[]'],
    returns: ORDER,
    meta: { body: CREATE, params: '{id:string}' },
  },
  { from: nodes[1]!.id, to: nodes[2]!.id, type: 'calls', confidence: 'static', params: [], returns: PAGE },
  {
    from: nodes[3]!.id,
    to: nodes[0]!.id,
    type: 'http_calls',
    confidence: 'static',
    params: ['{lines:{sku:string;qty:number}[]}'],
    returns: `null|${ORDER}`,
  },
  { from: nodes[5]!.id, to: nodes[4]!.id, type: 'emits', confidence: 'static', params: [ORDER] },
  // Recorded without names, by a graph built before names were.
  { from: nodes[1]!.id, to: nodes[6]!.id, type: 'calls', confidence: 'static', params: ['type:api#Missing'], returns: 'void' },
];

const packed = packGraph({
  builtAt: '2026-10-07T00:00:00.000Z',
  nodes,
  edges,
  unresolved: [],
  report,
  typeOf: (id) => registry[id],
});
const model = createModel(packed);

/** A type's position, by the name the page shows. */
const typeNamed = (name: string): number =>
  packed.shapes.types.findIndex((entry) => entry[0] === name);

describe('a reference written the way a person reads it', () => {
  it('names a registered type by its name, with its arguments', () => {
    expect(prettyRef(PAGE)).toBe('Page<Order>');
    expect(prettyRef('type:api#Order@src/b.ts')).toBe('Order');
  });

  it('spaces out unions, objects and arrays of unions', () => {
    expect(prettyRef(`null|${ORDER}`)).toBe('null | Order');
    expect(prettyRef('{a:string;b?:number}')).toBe('{ a: string; b?: number }');
    expect(prettyRef("('a'|'b')[]")).toBe("('a' | 'b')[]");
    expect(prettyRef('{}')).toBe('{}');
  });

  it('keeps text it cannot read as it is', () => {
    expect(prettyRef('{prototype:any;length')).toBe('{prototype:any;length');
  });
});

describe('what each node takes and gives back', () => {
  it('names a method’s parameters, marks the optional and the rest, and says what it returns', () => {
    const face = faceOf(model, 1);
    expect(face?.face).toBe('method');
    expect(face?.params.map((param) => [param.label, refText(model, param.ref), param.flag])).toEqual([
      ['dto', 'CreateOrder', 0],
      ['note', 'string', 1],
      ['tags', 'string[]', 2],
    ]);
    expect(faceLine(model, 1)).toBe('(dto: CreateOrder, note?: string, ...tags: string[]) → Order');
  });

  it('reads a route by the parts of the request its handler reads', () => {
    expect(faceOf(model, 0)?.face).toBe('route');
    expect(faceLine(model, 0)).toBe('body: CreateOrder · params: { id: string } → Order');
  });

  it('reads a call by what it sends and expects back, and a channel by its payload', () => {
    expect(faceLine(model, 3)).toBe('sends { lines: { sku: string; qty: number }[] } → null | Order');
    expect(faceLine(model, 5)).toBe('emits Order');
    expect(faceOf(model, 4)?.face).toBe('channel');
    expect(faceLine(model, 4)).toBe('payload Order');
  });

  it('falls back to the types on the edges in, unnamed, when the node recorded none', () => {
    expect(faceOf(model, 6)?.face).toBe('bare');
    expect(faceLine(model, 6)).toBe('(Missing) → void');
    // `list` takes nothing and its edge says so: an empty list, not no face.
    expect(faceLine(model, 2)).toBe('() → Page<Order>');
  });

  it('has no face for a node the graph says nothing about', () => {
    expect(faceOf(model, 7)).toBeNull();
    expect(faceLine(model, 7)).toBe('');
  });
});

describe('the types a face reaches', () => {
  it('ships what the faces reach through fields, and not the rest of the registry', () => {
    expect(packed.shapes.types.map((entry) => entry[0]).sort()).toEqual([
      'CreateOrder',
      'Line',
      'Order',
      'Page',
      'Status',
    ]);
  });

  it('cuts a reference into text and named types, a missing one marked -1', () => {
    const page = faceOf(model, 2)!.returns;
    expect(refParts(model, page)).toEqual([
      { text: 'Page', type: typeNamed('Page') },
      { text: '<' },
      { text: 'Order', type: typeNamed('Order') },
      { text: '>' },
    ]);
    const missing = faceOf(model, 6)!.params[0]!.ref;
    expect(refParts(model, missing)).toEqual([{ text: 'Missing', type: -1 }]);
  });

  it('opens a type to its fields, and those to theirs', () => {
    const order = typeInfo(model, typeNamed('Order'))!;
    expect(order.declaredIn).toBe('api#src/order.ts');
    expect(order.fields.map((field) => [field.name, refText(model, field.ref), field.optional])).toEqual([
      ['id', 'string', false],
      ['lines', 'Line[]', false],
      ['status', 'Status', false],
      ['parent', 'Order', true],
    ]);
    const line = refParts(model, order.fields[1]!.ref).find((part) => part.type !== undefined)!;
    expect(typeInfo(model, line.type!)!.fields.map((field) => field.name)).toEqual(['sku', 'qty']);
  });

  it('lists an enum’s values as words', () => {
    expect(typeInfo(model, typeNamed('Status'))!.members).toEqual([{ text: 'NEW' }, { text: 'PAID' }]);
  });

  it('answers as if there were no faces for a page packed without them', () => {
    const { shapes: _gone, ...older } = packed;
    const bare = createModel(older as typeof packed);
    expect(faceOf(bare, 1)).toBeNull();
    expect(faceLine(bare, 1)).toBe('');
  });
});

describe('opening everything under a row', () => {
  const [order, line, status, page, create] = ['Order', 'Line', 'Status', 'Page', 'CreateOrder'].map(typeNamed);
  const returnsOf = (node: number): number => faceOf(model, node)!.returns;

  it('reads the types a row sits inside off its name', () => {
    expect([...insideOf('p0')]).toEqual([]);
    expect([...insideOf(`p0:${order}.1:${line}.0`)]).toEqual([order, line]);
  });

  it('opens every type under a row, and a type that holds itself only once', () => {
    // `Order.parent` is an `Order`: it stays a name, so the walk ends.
    expect(openAll(model, [{ at: 'r', ref: returnsOf(1) }])).toEqual({
      keys: [`r:${order}`, `r:${order}.1:${line}`, `r:${order}.2:${status}`],
      left: 0,
    });
  });

  it('opens a whole section at once, each row under its own name', () => {
    const face = faceOf(model, 1)!;
    const roots = [...face.params.map((param, k) => ({ at: 'p' + k, ref: param.ref })), { at: 'r', ref: face.returns }];
    expect(openAll(model, roots).keys).toEqual([
      `p0:${create}`,
      `r:${order}`,
      `p0:${create}.0:${line}`,
      `r:${order}.1:${line}`,
      `r:${order}.2:${status}`,
    ]);
  });

  it('opens from one type of a row when asked to', () => {
    const ref = returnsOf(2);
    // `Page<Order>`: asked from `Order`, `Page` stays closed.
    expect(openAll(model, [{ at: 'r', ref, only: order }]).keys).toEqual([
      `r:${order}`,
      `r:${order}.1:${line}`,
      `r:${order}.2:${status}`,
    ]);
    expect(openAll(model, [{ at: 'r', ref, only: page }]).keys[0]).toBe(`r:${page}`);
  });

  it('stops at the bounds, deepest first, says how many it left, and goes on when asked again', () => {
    const roots = [{ at: 'r', ref: returnsOf(1) }];
    const first = openAll(model, roots, new Set(), { depth: 1, rows: 100 });
    expect(first).toEqual({ keys: [`r:${order}`], left: 2 });
    const next = openAll(model, roots, new Set(first.keys), { depth: 1, rows: 100 });
    expect(next).toEqual({ keys: [`r:${order}.1:${line}`, `r:${order}.2:${status}`], left: 0 });
    expect(openAll(model, roots, new Set(), { depth: 6, rows: 5 })).toEqual({ keys: [`r:${order}`], left: 2 });
  });

  it('keeps to the default bounds', () => {
    expect(TYPE_BOUNDS).toEqual({ depth: 6, rows: 300 });
  });
});

describe('a face written out as TypeScript', () => {
  it('writes a function with every named type opened inline, a type inside itself as its name', () => {
    expect(typeScriptOf(model, 1)).toEqual({
      text: [
        '// OrdersController.create',
        'function create(',
        '  dto: { // CreateOrder',
        '    lines: { // Line',
        '      sku: string;',
        '      qty: number;',
        '    }[];',
        '  },',
        '  note?: string,',
        '  ...tags: string[],',
        '): { // Order',
        '  id: string;',
        '  lines: { // Line',
        '    sku: string;',
        '    qty: number;',
        '  }[];',
        '  status: Status /* NEW | PAID */;',
        '  parent?: Order;',
        '};',
        '',
      ].join('\n'),
      left: 0,
    });
  });

  it('drops the arguments of a type it opened, since the opening is already of them', () => {
    const text = typeScriptOf(model, 2)!.text;
    expect(text.startsWith('// OrdersService.list\nfunction list(): { // Page\n  items: { // Order\n')).toBe(true);
    expect(text).not.toContain('<Order>');
  });

  it('writes a route as its request and response, a call as what it sends, a channel as its payload', () => {
    expect(typeScriptOf(model, 0)!.text).toContain('type Request = {\n  body: { // CreateOrder\n');
    expect(typeScriptOf(model, 0)!.text).toContain('  params: { id: string };\n};\ntype Response = { // Order\n');
    expect(typeScriptOf(model, 3)!.text).toContain(
      'type Sends = { lines: { sku: string; qty: number }[] };\ntype GetsBack = null | { // Order\n',
    );
    expect(typeScriptOf(model, 4)!.text).toMatch(/^\/\/ orders\/created\ntype Payload =\n  \| \{ \/\/ Order\n[^]*\n  \};\n$/);
  });

  it('names an unnamed parameter by its place, and a type it cannot read by its name', () => {
    expect(typeScriptOf(model, 6)!.text).toBe('// Audit.log\nfunction log(\n  arg1: Missing,\n): void;\n');
  });

  it('keeps types past the bounds as names and says how many', () => {
    const cut = typeScriptOf(model, 1, { depth: 1, rows: 100 })!;
    expect(cut.left).toBe(2);
    expect(cut.text).toContain('  lines: Line[];\n');
    expect(cut.text).toContain('// 2 more types left as names, past the bounds.');
  });

  it('has nothing to write for a node without a face', () => {
    expect(typeScriptOf(model, 7)).toBeNull();
  });
});

describe('a card a node shows on hover', () => {
  const order = typeNamed('Order');
  const status = typeNamed('Status');

  it('writes a function on one line, and peeks one level into each type it names', () => {
    expect(cardOf(model, 1)).toEqual({
      face: 'method',
      lines: ['create(dto: CreateOrder, note?: string, ...tags: string[]) → Order'],
      more: 0,
      peeks: [
        {
          type: typeNamed('CreateOrder'),
          name: 'CreateOrder',
          kind: 'object',
          from: 'api#src/order.dto.ts',
          rows: [{ name: 'lines', text: 'Line[]' }],
          more: 0,
          note: '',
        },
        {
          type: order,
          name: 'Order',
          kind: 'object',
          from: 'api#src/order.ts',
          rows: [
            { name: 'id', text: 'string' },
            { name: 'lines', text: 'Line[]' },
            { name: 'status', text: 'Status' },
            { name: 'parent?', text: 'Order' },
          ],
          more: 0,
          note: '',
        },
      ],
      left: 0,
      capped: false,
    });
  });

  it('puts a parameter to a line when the function does not fit on one', () => {
    expect(cardOf(model, 1, { ...CARD_BOUNDS, chars: 30 })!.lines).toEqual([
      'create(',
      '  dto: CreateOrder,',
      '  note?: string,',
      '  ...tags: string[],',
      ') → Order',
    ]);
  });

  it('reads a route, a call, a producer and a channel the way the panel does', () => {
    expect(cardOf(model, 0)!.lines).toEqual(['body: CreateOrder', 'params: { id: string }', '→ responds Order']);
    expect(cardOf(model, 3)!.lines).toEqual(['sends { lines: { sku: string; qty: number }[] }', '→ gets back null | Order']);
    expect(cardOf(model, 3)!.peeks.map((peek) => peek.name)).toEqual(['Order']);
    expect(cardOf(model, 5)!.lines).toEqual(['emits Order']);
    expect(cardOf(model, 4)!.lines).toEqual(['payload Order']);
  });

  it('peeks at nothing it cannot open, and has no card for a node without a face', () => {
    expect(cardOf(model, 6)).toEqual({
      face: 'bare', lines: ['log(Missing) → void'], more: 0, peeks: [], left: 0, capped: false,
    });
    expect(cardOf(model, 7)).toBeNull();
  });

  it('keeps to its bounds and counts what it left out', () => {
    const cut = cardOf(model, 1, { lines: 2, types: 1, rows: 2, chars: 20, most: 200 })!;
    expect(cut.lines).toEqual(['create(', '  dto: CreateOrder,']);
    expect(cut.more).toBe(3);
    expect(cut.peeks.map((peek) => peek.name)).toEqual(['CreateOrder']);
    expect(cut.left).toBe(1);
    expect(peekOf(model, order, { ...CARD_BOUNDS, rows: 2 })).toMatchObject({
      rows: [{ name: 'id' }, { name: 'lines' }],
      more: 2,
    });
  });

  it('lists an enum’s values as its rows', () => {
    expect(peekOf(model, status)).toEqual({
      type: status,
      name: 'Status',
      kind: 'enum',
      from: 'api#src/order.ts',
      rows: [{ name: '|', text: 'NEW' }, { name: '|', text: 'PAID' }],
      more: 0,
      note: '',
    });
  });

  it('keeps to the default bounds', () => {
    expect(CARD_BOUNDS).toEqual({ lines: 12, types: 4, rows: 8, chars: 72, most: 200 });
    expect(GLANCE).toEqual({ lines: false, types: false, rows: [] });
  });
});

describe('a card asked for what it cut', () => {
  const order = typeNamed('Order');
  const create = typeNamed('CreateOrder');
  const small = { lines: 2, types: 1, rows: 2, chars: 20, most: 200 };

  it('shows every row of a type it is asked to, and only of that type', () => {
    const card = cardOf(model, 1, { ...small, types: 2 }, { ...GLANCE, rows: [order] })!;
    expect(card.peeks.find((peek) => peek.type === order)).toMatchObject({ more: 0 });
    expect(card.peeks.find((peek) => peek.type === order)!.rows).toHaveLength(4);
    expect(card.peeks.find((peek) => peek.type === create)!.rows).toHaveLength(1);
  });

  it('shows the rest of the face, and the types left out, when asked', () => {
    const card = cardOf(model, 1, small, { lines: true, types: true, rows: [] })!;
    expect(card.lines).toEqual(['create(', '  dto: CreateOrder,', '  note?: string,', '  ...tags: string[],', ') → Order']);
    expect(card.more).toBe(0);
    expect(card.peeks.map((peek) => peek.type)).toEqual([create, order]);
    expect(card.left).toBe(0);
    expect(card.capped).toBe(false);
  });

  it('holds no more than its ceiling, and says the ceiling is what cut it', () => {
    // Five lines, then CreateOrder's head and its one row: two rows left for Order.
    const card = cardOf(model, 1, { ...small, most: 9 }, { lines: true, types: true, rows: [order] })!;
    expect(card.lines).toHaveLength(5);
    expect(card.peeks.map((peek) => [peek.name, peek.rows.length, peek.more])).toEqual([
      ['CreateOrder', 1, 0],
      ['Order', 1, 3],
    ]);
    expect(card.capped).toBe(true);
    // A ceiling the face alone fills begins no peek.
    const full = cardOf(model, 1, { ...small, most: 5 }, { lines: true, types: true, rows: [] })!;
    expect(full.peeks).toEqual([]);
    expect(full.left).toBe(2);
    expect(full.capped).toBe(true);
  });

  it('is not capped when the glance, not the ceiling, is what leaves something out', () => {
    expect(cardOf(model, 1, small)!.capped).toBe(false);
  });
});

describe('where the panel opens what a card showed', () => {
  it('names each row of the face that holds a type the card showed', () => {
    const order = typeNamed('Order');
    const create = typeNamed('CreateOrder');
    expect(panelKeysOf(model, 1, [create, order])).toEqual([`p0:${create}`, `r:${order}`]);
    expect(panelKeysOf(model, 0, [create])).toEqual([`p0:${create}`]);
    expect(panelKeysOf(model, 1, [])).toEqual([]);
    expect(panelKeysOf(model, 7, [order])).toEqual([]);
  });
});

describe('a way in that is not a request', () => {
  const handlerNodes: GraphNode[] = [
    /* 0 */ { id: 'entry:web:ui:click:save', type: 'entry', kind: 'click', label: 'click Save', repo: 'web' },
    /* 1 */ {
      id: 'web#src/order.component.ts:OrderComponent.onSave',
      type: 'method',
      label: 'OrderComponent.onSave',
      repo: 'web',
      meta: { signature: { params: [{ name: 'order', type: ORDER }], returns: 'void' } },
    },
    /* 2 */ { id: 'entry:web:ui:click:nothing', type: 'entry', kind: 'click', label: 'click Nothing', repo: 'web' },
    /* 3 */ { id: 'web#src/order.component.ts:OrderComponent.untyped', type: 'method', label: 'OrderComponent.untyped', repo: 'web' },
  ];
  const handlerEdges: GraphEdge[] = [
    { from: handlerNodes[0]!.id, to: handlerNodes[1]!.id, type: 'handles', confidence: 'static', params: [ORDER], returns: 'void' },
    { from: handlerNodes[2]!.id, to: handlerNodes[3]!.id, type: 'handles', confidence: 'static' },
  ];
  const handlerModel = createModel(
    packGraph({
      builtAt: '2026-10-07T00:00:00.000Z',
      nodes: handlerNodes,
      edges: handlerEdges,
      unresolved: [],
      report,
      typeOf: (id) => registry[id],
    }),
  );

  it('says what it hands the function that answers it, under that function’s name', () => {
    expect(faceOf(handlerModel, 0)?.face).toBe('handler');
    expect(faceLine(handlerModel, 0)).toBe('onSave(order: Order) → void');
    expect(cardOf(handlerModel, 0)!.lines).toEqual(['onSave(order: Order) → void']);
    expect(typeScriptOf(handlerModel, 0)!.text).toContain('function onSave(\n  order: {');
  });

  it('has no face when its handler recorded none', () => {
    expect(faceOf(handlerModel, 2)).toBeNull();
  });
});
