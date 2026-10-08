import { Project, type SourceFile } from 'ts-morph';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import {
  CLAIMED_META,
  FAILURES_META,
  readRequest,
  REQUEST_READ_META,
  requestReadingSchema,
  routeShapeEdge,
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
  validators: [{ package: 'checker-lib', methods: ['parse'], arg: 0 }],
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
export interface Schema<T> { parse(input: unknown): T }
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
  req: { valid(target: string): CreateOrder; json<T = any>(): Promise<T> };
  json(body: unknown, status?: number): unknown;
  body: unknown;
}
export const viaCall = (c: Ctx) => c.json({ id: 'x' } satisfies Order, 201);
export const asked = async (c: Ctx) => {
  const body = await c.req.json<CreateOrder>();
  return c.json(body);
};
export const assigned = (ctx: Ctx) => { ctx.body = { id: 'y' } as Order; };
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

  it('keeps an answer sent with a failure apart, and leaves out one whose status is not a number', () => {
    expect(read(handlers, 'failing')).toMatchObject({
      response: { ref: 'type:shop#Order', claimed: false },
      failures: { '404': 'type:shop#Problem' },
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
  });
});
