import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import {
  callsHelper,
  CLAIMED_META,
  extendReading,
  FAILURES_META,
  pathParamsOf,
  readRequest,
  REQUEST_READ_META,
  requestReadingSchema,
  routeShapeEdge,
  STATUS_UNKNOWN_META,
  type RequestReadingDescription,
} from './request.js';
import { TypeCollector } from './types/collector.js';

/** A framework of the usual shape, as a project would describe it. */
const HANDED: RequestReadingDescription = {
  parts: {
    body: [{ param: 0, at: ['body'] }],
    params: [{ param: 0, at: ['params'] }],
    query: [{ param: 0, at: ['query'] }],
    headers: [{ param: 0, at: ['headers'] }],
  },
  answers: [{ by: 'call', param: 1, methods: ['json', 'send'], statusMethods: ['status'] }],
  defaults: ['Headers'],
  validators: [
    { package: 'checker-lib', methods: ['parse'], arg: 0 },
    { package: 'checker-lib', methods: ['safeParse'], arg: 0, at: ['data'] },
  ],
};

const FRAMEWORK = `
export interface Headers { host?: string; accept?: string }
export interface Req<Body = any, Params = Record<string, string>> {
  body: Body;
  params: Params;
  query: Record<string, string>;
  headers: Headers;
}
export interface Res<Answer = any> {
  status(code: number): Res<Answer>;
  json(body: Answer): Res<Answer>;
  send(body?: any): Res<Answer>;
}
`;

const CHECKER = `
export interface Schema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error };
}
export declare function object<T>(shape: T): Schema<T>;
`;

const HANDLERS = `
import type { Req, Res } from './framework';
import { object } from 'checker-lib';

export interface CreateOrder { total: number; note?: string }
export interface Order { id: string; total: number }
export interface Problem { message: string }
const CreateSchema = object<CreateOrder>({ total: 0 });

export const typed = (req: Req<CreateOrder, { id: string }>, res: Res<Order>) => {
  res.json({ id: req.params.id, total: req.body.total });
};
export const untyped = (req: Req, res: Res) => { res.send(); };
export const cast = (req: Req, res: Res) => {
  const order = req.body as CreateOrder;
  res.json(order);
};
export const doubleCast = (req: Req, res: Res) => {
  res.json((req.body as unknown as CreateOrder).total);
};
export const annotated = (req: Req, res: Res) => {
  const order: CreateOrder = req.body;
  res.send('ok');
};
export const destructured = (req: Req, res: Res) => {
  const { body } = req;
  res.json(body as Order);
};
export const checked = (req: Req, res: Res) => {
  const order = CreateSchema.parse(req.body);
  res.json(order);
};
export const disagreeing = (req: Req, res: Res) => {
  const a = req.body as CreateOrder;
  const b = req.body as Order;
  res.send({ a, b });
};
export const failing = (req: Req, res: Res, found: Order | undefined, code: number) => {
  if (found === undefined) return res.status(404).json({ message: 'gone' } as Problem);
  if (found.total < 0) return res.status(code).json('unknown status');
  return res.status(200).json(found);
};
export const safe = (req: Req, res: Res) => {
  const result = CreateSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'bad' } as Problem);
  return res.json(result.data);
};
export const twoAnswers = (req: Req, res: Res, found: Order | undefined) => {
  if (found === undefined) return res.json(null);
  if (found.total > 10) return res.json({ big: true });
  return res.json(found);
};
`;

const PLATFORM = `
export interface Event { body: string | null; pathParameters: { [name: string]: string | undefined } | null }
export interface CreateOrder { total: number }
export interface Order { id: string }
export const parsed = async (event: Event) => {
  const order = JSON.parse(event.body ?? '{}') as CreateOrder;
  if (order.total < 0) return { statusCode: 400, body: JSON.stringify({ reason: 'negative' }) };
  const made: Order = { id: 'o1' };
  return { statusCode: 201, body: JSON.stringify(made) };
};
export const shaped = async (event: { body: CreateOrder }) => ({ statusCode: 200, body: JSON.stringify(event.body) });
`;

const CONTEXT = `
export interface CreateOrder { total: number }
export interface Order { id: string }
interface Ctx {
  req: {
    valid(target: string): CreateOrder;
    json<T = any>(): Promise<T>;
    param(): Record<string, string>;
    param(name: string): string;
  };
  json(body: unknown, status?: number): unknown;
  body: unknown;
}
export const viaCall = (c: Ctx) => c.json({ id: 'x' } satisfies Order, 201);
export const asked = async (c: Ctx) => {
  const body = await c.req.json<CreateOrder>();
  return c.json(body);
};
export const assigned = (ctx: Ctx) => { ctx.body = { id: 'y' } as Order; };
export const byPath = (c: Ctx) => c.json({ id: c.req.param('id') } satisfies Order);
export declare const Answer: { json<T>(body: T, init?: { status?: number }): unknown };
export const named = () => Answer.json({ id: 'z' }, { status: 202 });
`;

describe('what a request carries, read the way its framework puts it', () => {
  let project: Project;
  let collector: TypeCollector;
  let handlers: SourceFile;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    project.createSourceFile('/node_modules/checker-lib/index.d.ts', CHECKER);
    project.createSourceFile('/node_modules/checker-lib/package.json', '{"name":"checker-lib","types":"index.d.ts"}');
    project.createSourceFile('/src/framework.ts', FRAMEWORK);
    handlers = project.createSourceFile('/src/handlers.ts', HANDLERS);
    const builder = new GraphBuilder({ repo: 'shop', generatedAt: '2026-01-01T00:00:00.000Z' });
    collector = new TypeCollector({ builder, repo: 'shop' });
  });

  const read = (file: SourceFile, name: string, description: RequestReadingDescription = HANDED) =>
    readRequest(file.getVariableDeclarationOrThrow(name), requestReadingSchema.parse(description), (type, site) =>
      collector.collectType(type, site),
    );

  it('reads the parts a type argument states, and says the answer the response is held to', () => {
    expect(read(handlers, 'typed')).toEqual({
      parts: {
        body: { ref: 'type:shop#CreateOrder', claimed: false },
        params: { ref: '{id:string}', claimed: false },
      },
      response: { ref: 'type:shop#Order', claimed: false },
      failures: {},
    });
  });

  it('records nothing for a part the framework leaves as a default, or an answer with nothing in it', () => {
    expect(read(handlers, 'untyped')).toEqual({ parts: {}, failures: {} });
  });

  it('records a cast or an annotation as claimed, wherever the part is read from', () => {
    expect(read(handlers, 'cast')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: true });
    expect(read(handlers, 'annotated')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: true });
    expect(read(handlers, 'doubleCast')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: true });
    expect(read(handlers, 'destructured')?.response).toEqual({ ref: 'type:shop#Order', claimed: true });
  });

  it('a string written is answered as a string, not as the one written', () => {
    expect(read(handlers, 'annotated')?.response).toEqual({ ref: 'string', claimed: false });
  });

  it("takes a validator's output as the checked shape, matched by the package that declares it", () => {
    expect(read(handlers, 'checked')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: false });
    const elsewhere = { ...HANDED, validators: [{ package: 'other-lib', methods: ['parse'] }] };
    expect(read(handlers, 'checked', elsewhere)?.parts.body).toBeUndefined();
  });

  it('two different claims for one part are no answer', () => {
    expect(read(handlers, 'disagreeing')?.parts.body).toBeUndefined();
  });

  it('keeps an answer sent with a failure apart, and one whose status the code works out apart from both', () => {
    expect(read(handlers, 'failing')).toEqual({
      parts: {},
      response: { ref: 'type:shop#Order', claimed: false },
      failures: { '404': 'type:shop#Problem' },
      statusUnknown: 'string',
    });
  });

  it("takes the checked value out of a validator's result, once the result says it succeeded", () => {
    expect(read(handlers, 'safe')).toEqual({
      parts: { body: { ref: 'type:shop#CreateOrder', claimed: false } },
      response: { ref: 'type:shop#CreateOrder', claimed: false },
      failures: { '400': 'type:shop#Problem' },
    });
  });

  it('answers with each of several shapes once', () => {
    expect(read(handlers, 'twoAnswers')?.response?.ref).toBe('type:shop#Order|{big:boolean}');
  });

  it('reads a body that arrives as text through what the code parses it into, and the answer out of what it returns', () => {
    const platform = project.createSourceFile('/src/platform.ts', PLATFORM);
    const description: RequestReadingDescription = {
      parts: {
        body: [{ param: 0, at: ['body'], text: true }],
        params: [{ param: 0, at: ['pathParameters'] }],
      },
      answers: [{ by: 'return', at: ['body'], text: true, statusAt: ['statusCode'] }],
    };
    expect(read(platform, 'parsed', description)).toEqual({
      parts: { body: { ref: 'type:shop#CreateOrder', claimed: true } },
      response: { ref: 'type:shop#Order', claimed: false },
      failures: { '400': '{reason:string}' },
    });
    expect(read(platform, 'shaped', description)?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: false });
  });

  it('reads parts handed back by a call, an answer called, assigned or handed to a named function', () => {
    const context = project.createSourceFile('/src/context.ts', CONTEXT);
    const description: RequestReadingDescription = {
      calls: [
        { param: 0, at: ['req'], method: 'valid', byArgument: { json: 'body' } },
        { param: 0, at: ['req'], method: 'json', part: 'body', claim: true },
      ],
      answers: [
        { by: 'call', param: 0, methods: ['json'], statusArg: 1 },
        { by: 'assign', param: 0, at: ['body'] },
        { by: 'named', callee: 'Answer.json', statusKey: 'status' },
      ],
    };
    // `satisfies` checks the value without changing its type.
    expect(read(context, 'viaCall', description)?.response).toEqual({ ref: '{id:string}', claimed: false });
    expect(read(context, 'asked', description)).toEqual({
      parts: { body: { ref: 'type:shop#CreateOrder', claimed: true } },
      response: { ref: 'type:shop#CreateOrder', claimed: false },
      failures: {},
    });
    expect(read(context, 'assigned', description)?.response).toEqual({ ref: 'type:shop#Order', claimed: true });
    expect(read(context, 'named', description)?.response).toEqual({ ref: '{id:string}', claimed: false });
  });

  it('names the path params a handler reads by the path, when nothing types them', () => {
    const context = project.createSourceFile('/src/context.ts', CONTEXT);
    const reading = requestReadingSchema.parse({ calls: [{ param: 0, at: ['req'], method: 'param', part: 'params' }] });
    const collect = (type: Parameters<TypeCollector['collectType']>[0], site: Parameters<TypeCollector['collectType']>[1]) =>
      collector.collectType(type, site);
    const handler = context.getVariableDeclarationOrThrow('byPath');
    expect(readRequest(handler, reading, collect, { path: '/orders/:id/lines/:line?' })?.parts.params).toEqual({
      ref: '{id:string;line?:string}',
      claimed: false,
    });
    // No path, nothing named; a handler that reads no params gets none.
    expect(readRequest(handler, reading, collect)?.parts.params).toBeUndefined();
    const other = context.getVariableDeclarationOrThrow('assigned');
    expect(readRequest(other, reading, collect, { path: '/orders/:id' })?.parts.params).toBeUndefined();
  });

  it('writes a shape on the edge under the keys a route has always used', () => {
    const shape = read(handlers, 'cast');
    expect(shape).toBeDefined();
    expect(routeShapeEdge(shape!)).toEqual({
      // The answer is a variable whose type came from a cast; only the cast itself is a claim.
      meta: { [REQUEST_READ_META]: true, body: 'type:shop#CreateOrder', [CLAIMED_META]: ['body'] },
      returns: 'type:shop#CreateOrder',
    });
    const failing = read(handlers, 'failing');
    expect(routeShapeEdge(failing!).meta?.[FAILURES_META]).toEqual({ '404': 'type:shop#Problem' });
    expect(routeShapeEdge(failing!).meta?.[STATUS_UNKNOWN_META]).toBe('string');
  });
});

/**
 * A handler that answers through a helper of its project's, and parses its
 * body through another, from a package nobody installed (P30). The imports are
 * all the helpers' calls have to be matched by.
 */
const HELPED = `
import { respond as answer, readJson, fail } from '@acme/http-kit';
import * as kit from '@acme/http-kit';
export interface Event { body: string | null; pathParameters: Record<string, string | undefined> | null }
export interface CreateOrder { total: number }
export interface Order { id: string; total: number }
export interface Problem { message: string }
export enum Status { Created = 201, Gone = 410 }
const OK = 200;
const sendOk = (res: unknown, body: unknown): unknown => body;

export const viaHelper = async (event: Event) => {
  const order = JSON.parse(event.body ?? '{}') as CreateOrder;
  if (order.total < 0) return answer(400, { message: 'negative' } as Problem);
  const made: Order = { id: 'o1', total: order.total };
  return answer(201, made);
};
export const viaNamespace = async (event: Event) => kit.respond(OK, { id: 'o2', total: 1 } as Order);
export const viaEnum = async (event: Event, gone: boolean) =>
  gone ? answer(Status.Gone, { message: 'x' } as Problem) : answer(Status.Created, { id: 'o3', total: 2 } as Order);
export const computed = async (event: Event, code: number) => answer(code, { id: 'o4', total: 3 } as Order);
export const parsedByHelper = async (event: Event) => {
  const order = readJson<CreateOrder>(event);
  return answer(202, { id: 'o5', total: order.total } as Order);
};
export const bodyParsed = async (event: Event) => {
  const order = event.body as unknown as CreateOrder;
  return answer(200, { id: 'o6', total: order.total } as Order);
};
export const lookalike = async (event: Event) => {
  const respond = (status: number, body: unknown) => ({ statusCode: status, body });
  return respond(200, { id: 'o7', total: 4 } as Order);
};
export const local = (req: unknown, res: unknown) => {
  sendOk(res, { id: 'o8', total: 5 } as Order);
};
export const severalArguments = async (event: Event, missing: boolean, detail: { field: string }) => {
  if (missing) return fail(404, 'not_found', \`no order \${event.body}\`);
  if (event.body === null) return fail(400, 'bad_input', 'no body', detail);
  return answer(200, { id: 'o9', total: 6 } as Order);
};
`;

const KOA_LIKE = `
export interface Order { id: string }
export interface Problem { message: string }
interface Ctx { status: number; body: unknown; params: Record<string, string> }
export const created = (ctx: Ctx) => {
  ctx.status = 201;
  ctx.body = { id: 'k1' } as Order;
};
export const missing = (ctx: Ctx, found: boolean) => {
  if (!found) {
    ctx.status = 404;
    ctx.body = { message: 'gone' } as Problem;
    return;
  }
  ctx.body = { id: ctx.params.id } as Order;
};
`;

describe("a project's own helpers, read beside its framework's places (P30)", () => {
  let project: Project;
  let collector: TypeCollector;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const builder = new GraphBuilder({ repo: 'shop', generatedAt: '2026-01-01T00:00:00.000Z' });
    collector = new TypeCollector({ builder, repo: 'shop' });
  });

  const GATEWAY_LIKE: RequestReadingDescription = {
    parts: {
      body: [{ param: 0, at: ['body'], text: true }],
      params: [{ param: 0, at: ['pathParameters'] }],
    },
    answers: [{ by: 'return', at: ['body'], text: true, statusAt: ['statusCode'] }],
  };
  const PROJECT: RequestReadingDescription = {
    helpers: [{ name: 'readJson', package: '@acme/http-kit', part: 'body' }],
    answers: [
      { by: 'helper', name: 'respond', package: '@acme/http-kit', statusArg: 0, arg: 1 },
      { by: 'helper', name: 'sendOk', arg: 1, status: 200 },
      { by: 'helper', name: 'fail', package: '@acme/http-kit', statusArg: 0, fields: { code: 1, message: 2, detail: 3 } },
    ],
  };

  const read = (source: string, name: string, path?: string) => {
    const file = project.createSourceFile('/src/handlers.ts', source, { overwrite: true });
    const reading = extendReading(requestReadingSchema.parse(GATEWAY_LIKE), requestReadingSchema.parse(PROJECT));
    return readRequest(
      file.getVariableDeclarationOrThrow(name),
      reading,
      (type, site) => collector.collectType(type, site),
      path === undefined ? {} : { path },
    );
  };

  it('reads the answer a helper of an uninstalled package is handed, with the status it is handed', () => {
    expect(read(HELPED, 'viaHelper')).toEqual({
      parts: { body: { ref: 'type:shop#CreateOrder', claimed: true } },
      response: { ref: 'type:shop#Order', claimed: false },
      failures: { '400': 'type:shop#Problem' },
    });
  });

  it('matches the helper through a namespace import, and a status written as a constant', () => {
    expect(read(HELPED, 'viaNamespace')?.response).toEqual({ ref: 'type:shop#Order', claimed: true });
  });

  it('reads a status written as an enum member by the value the checker knows', () => {
    expect(read(HELPED, 'viaEnum')).toMatchObject({
      response: { ref: 'type:shop#Order' },
      failures: { '410': 'type:shop#Problem' },
    });
  });

  it('keeps an answer whose status the code works out apart from the answer and the failures', () => {
    expect(read(HELPED, 'computed')).toEqual({ parts: {}, failures: {}, statusUnknown: 'type:shop#Order' });
  });

  it("reads a body a helper hands back by the type argument the call asks for, as a claim", () => {
    expect(read(HELPED, 'parsedByHelper')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: true });
  });

  it('reads a body a parser in front already turned into a shape, by the cast on the read', () => {
    expect(read(HELPED, 'bodyParsed')?.parts.body).toEqual({ ref: 'type:shop#CreateOrder', claimed: true });
  });

  it("does not take a function of the same name that is not the package's for the helper", () => {
    expect(read(HELPED, 'lookalike')?.response).toBeUndefined();
  });

  it("matches a helper of the project's own by its declaration, with the status it always answers", () => {
    expect(read(HELPED, 'local')?.response).toEqual({ ref: 'type:shop#Order', claimed: true });
  });

  it('builds a failure from several arguments of a helper, each field typed by its argument (P33)', () => {
    expect(read(HELPED, 'severalArguments')).toEqual({
      parts: {},
      response: { ref: 'type:shop#Order', claimed: true },
      failures: {
        '400': '{code:string;detail:{field:string};message:string}',
        '404': '{code:string;message:string}',
      },
    });
  });

  it('reads a status assigned before the answer, in the block the answer is in or one around it', () => {
    project.createSourceFile('/src/koa.ts', KOA_LIKE);
    const reading = requestReadingSchema.parse({
      parts: { params: [{ param: 0, at: ['params'] }] },
      answers: [{ by: 'assign', param: 0, at: ['body'], statusAt: ['status'] }],
    });
    const file = project.getSourceFileOrThrow('/src/koa.ts');
    const collect = (type: Parameters<TypeCollector['collectType']>[0], site: Parameters<TypeCollector['collectType']>[1]) =>
      collector.collectType(type, site);
    expect(readRequest(file.getVariableDeclarationOrThrow('created'), reading, collect)).toMatchObject({
      response: { ref: 'type:shop#Order' },
      failures: {},
    });
    expect(readRequest(file.getVariableDeclarationOrThrow('missing'), reading, collect, { path: '/orders/:id' })).toEqual({
      parts: { params: { ref: '{id:string}', claimed: false } },
      response: { ref: 'type:shop#Order', claimed: true },
      failures: { '404': 'type:shop#Problem' },
    });
  });
});

describe('the params a path names', () => {
  it('reads every spelling a framework writes a param in', () => {
    expect(pathParamsOf('/orders/:id/lines/:line?')).toBe('{id:string;line?:string}');
    expect(pathParamsOf('/files/{proxy+}')).toBe('{proxy:string}');
    expect(pathParamsOf('/foo-:id/:a-:b')).toBe('{a:string;b:string;id:string}');
    expect(pathParamsOf('/blog/[...slug]')).toBe('{slug:string}');
    expect(pathParamsOf('/orders/{orderId}')).toBe('{orderId:string}');
  });

  it('names nothing for a path without params', () => {
    expect(pathParamsOf('/orders')).toBeUndefined();
  });
});

describe('a package helper reached through a default import or a barrel of the repository', () => {
  const callsIn = (files: Record<string, string>, helper: { name: string; package: string }): string[] => {
    const project = new Project({ useInMemoryFileSystem: true });
    for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
    return project
      .getSourceFileOrThrow('/src/use.ts')
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => callsHelper(call, helper))
      .map((call) => call.getText());
  };

  it("matches a default import called itself when the row names it 'default', and nothing else", () => {
    expect(
      callsIn(
        {
          '/src/use.ts': [
            "import respond from '@acme/http-kit';",
            "import other from '@acme/other-kit';",
            'respond(200, {});',
            'other(200, {});',
            'const shadow = () => { const respond = (a: number) => a; return respond(1); };',
          ].join('\n'),
        },
        { name: 'default', package: '@acme/http-kit' },
      ),
    ).toEqual(['respond(200, {})']);
  });

  it('matches a helper re-exported through a local barrel, named, renamed, starred or imported and exported again', () => {
    const files = {
      '/src/http/index.ts': [
        "export { respond } from '@acme/http-kit';",
        "export { fail as refuse } from '@acme/http-kit';",
        "export { default as send } from '@acme/http-kit';",
        "export * from './more';",
        "export const lookalike = (status: number) => status;",
      ].join('\n'),
      '/src/http/more.ts': [
        "import { respond as again } from '@acme/http-kit';",
        'export { again };',
        "export * from '@acme/other-kit';",
      ].join('\n'),
      '/src/use.ts': [
        "import { respond, refuse, send, again, lookalike, otherRespond } from './http';",
        "import * as http from './http';",
        'respond(200, {});',
        'refuse(400);',
        'send(200);',
        'again(201, {});',
        'http.respond(202, {});',
        'lookalike(500);',
        'otherRespond(500);',
      ].join('\n'),
    };
    expect(callsIn(files, { name: 'respond', package: '@acme/http-kit' })).toEqual([
      'respond(200, {})',
      'again(201, {})',
      'http.respond(202, {})',
    ]);
    expect(callsIn(files, { name: 'fail', package: '@acme/http-kit' })).toEqual(['refuse(400)']);
    expect(callsIn(files, { name: 'default', package: '@acme/http-kit' })).toEqual(['send(200)']);
    expect(callsIn(files, { name: 'lookalike', package: '@acme/http-kit' })).toEqual([]);
  });

  it("follows a default import a barrel exports again by name, as the package's 'default'", () => {
    const files = {
      '/src/http/index.ts': ["import respond from '@acme/http-kit';", 'export { respond };'].join('\n'),
      '/src/use.ts': ["import { respond } from './http';", 'respond(200, {});'].join('\n'),
    };
    expect(callsIn(files, { name: 'default', package: '@acme/http-kit' })).toEqual(['respond(200, {})']);
    expect(callsIn(files, { name: 'respond', package: '@acme/http-kit' })).toEqual([]);
  });

  it('matches neither of two star exports that pass on one name from two places', () => {
    const files = {
      '/src/http/index.ts': ["export * from './a';", "export * from './b';", "export * from './c';"].join('\n'),
      '/src/http/a.ts': "export { respond, fail } from '@acme/http-kit';",
      '/src/http/b.ts': "export { respond } from '@acme/other-kit';",
      '/src/http/c.ts': 'export const fail = (status: number) => status;',
      '/src/use.ts': ["import { respond, fail } from './http';", 'respond(200, {});', 'fail(500);'].join('\n'),
    };
    expect(callsIn(files, { name: 'respond', package: '@acme/http-kit' })).toEqual([]);
    expect(callsIn(files, { name: 'respond', package: '@acme/other-kit' })).toEqual([]);
    expect(callsIn(files, { name: 'fail', package: '@acme/http-kit' })).toEqual([]);
  });
});
