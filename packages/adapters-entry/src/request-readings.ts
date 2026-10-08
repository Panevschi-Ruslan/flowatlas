import { requestReadingSchema, type RequestReading, type RequestReadingDescription } from '@flowatlas/core';

/**
 * Where each framework puts what a request carries and how a handler answers
 * it, as descriptions (P29).
 *
 * The reading is one function in the core, and every framework here is a row
 * of places for it: which parameter is the request, which keys hold the body,
 * the path params, the query and the headers, and what a handler calls,
 * assigns or returns to answer. A framework that cannot be said this way is a
 * framework this does not read, and says nothing rather than something wrong.
 *
 * Each row goes through the same schema a project's own description does, so
 * what ships is proof that the description can say what these frameworks need.
 */

/**
 * The validation libraries whose check hands back a typed value.
 *
 * Not a fact about any framework, which is why they sit apart and are added to
 * every description: `schema.parse(req.body)` is the same evidence under
 * Express as under a Lambda. Each is matched by where the called function is
 * declared, so a `parse` of anyone else's is not mistaken for one.
 */
export const VALIDATORS: NonNullable<RequestReadingDescription['validators']> = [
  // `Schema.parse(input)`, `await Schema.parseAsync(input)`.
  { package: 'zod', methods: ['parse', 'parseAsync'], arg: 0 },
  // `parse(Schema, input)`, `v.parse(Schema, input)`.
  { package: 'valibot', methods: ['parse', 'parseAsync'], arg: 1 },
  // `await schema.validate(input)`, `schema.validateSync(input)`, `schema.cast(input)`.
  { package: 'yup', methods: ['validate', 'validateSync', 'cast'], arg: 0 },
  // `create(input, Struct)`, `mask(input, Struct)`.
  { package: 'superstruct', methods: ['create', 'mask'], arg: 0 },
];

/**
 * A description as the reader uses it: validated, with the shared validators
 * after the description's own.
 */
export const readingOf = (description: RequestReadingDescription): RequestReading =>
  requestReadingSchema.parse({
    ...description,
    validators: [...(description.validators ?? []), ...VALIDATORS],
  });

/** The four parts of a request handed over as one object, at the same keys. */
const partsAt = (param: number): RequestReadingDescription['parts'] => ({
  body: [{ param, at: ['body'] }],
  params: [{ param, at: ['params'] }],
  query: [{ param, at: ['query'] }],
  headers: [{ param, at: ['headers'] }],
});

/** Headers as a Node server types them when nothing narrower was written. */
const NODE_HEADERS = 'IncomingHttpHeaders';

/**
 * Express, and every framework that copied its handler: `(req, res) => …`.
 *
 * `Request<Params, ResBody, ReqBody, Query>` types the parts where a route says
 * so and leaves them `any` and dictionaries where it does not; `res.json(x)`
 * answers, `res.status(n)` in front of it says with what. What a handler
 * returns is not the answer.
 */
export const EXPRESS_REQUEST: RequestReadingDescription = {
  parts: partsAt(0),
  answers: [{ by: 'call', param: 1, methods: ['json', 'send', 'jsonp'], statusMethods: ['status'] }],
  defaults: [NODE_HEADERS, 'ParamsDictionary', 'ParsedQs'],
};

/**
 * Fastify: the same four keys on the request, typed by the route's own type
 * argument (`app.post<{ Body: CreateOrder }>`) or the request's
 * (`FastifyRequest<{ Body: … }>`). A handler answers with `reply.send(x)`, with
 * `reply.code(n)` in front, or by returning the value.
 */
export const FASTIFY_REQUEST: RequestReadingDescription = {
  parts: partsAt(0),
  answers: [
    { by: 'call', param: 1, methods: ['send'], statusMethods: ['code', 'status'] },
    { by: 'return' },
  ],
  defaults: [NODE_HEADERS],
};

/**
 * Koa, where the request is one context: the body a parser put on
 * `ctx.request.body`, the router's `ctx.params`, and the answer assigned to
 * `ctx.body`.
 */
export const KOA_REQUEST: RequestReadingDescription = {
  parts: {
    body: [{ param: 0, at: ['request', 'body'] }],
    params: [{ param: 0, at: ['params'] }],
    query: [{ param: 0, at: ['query'] }],
    headers: [{ param: 0, at: ['headers'] }],
  },
  answers: [{ by: 'assign', param: 0, at: ['body'] }],
  defaults: [NODE_HEADERS, 'ParsedUrlQuery'],
};

/**
 * Hono: a part is asked for. `c.req.valid('json')` hands back what a validator
 * in front of the route checked, typed by it; `c.req.json<T>()` hands back what
 * the code says, which nothing checks. `c.json(x, status)` answers.
 */
export const HONO_REQUEST: RequestReadingDescription = {
  calls: [
    {
      param: 0,
      at: ['req'],
      method: 'valid',
      byArgument: { json: 'body', form: 'body', query: 'query', param: 'params', header: 'headers' },
    },
    { param: 0, at: ['req'], method: 'json', part: 'body', claim: true },
  ],
  answers: [{ by: 'call', param: 0, methods: ['json', 'text'], statusArg: 1 }],
};

/**
 * A route file of the App Router: `export async function POST(request, { params })`.
 *
 * The body is whatever `await request.json()` is said to be, which only a
 * validator checks; the path params are the second argument's. The answer is
 * handed to `NextResponse.json` or `Response.json`, with `{ status }` beside it.
 */
export const APP_ROUTE_REQUEST: RequestReadingDescription = {
  parts: { params: [{ param: 1, at: ['params'] }] },
  calls: [{ param: 0, at: [], method: 'json', part: 'body' }],
  answers: [
    { by: 'named', callee: 'NextResponse.json', statusKey: 'status' },
    { by: 'named', callee: 'Response.json', statusKey: 'status' },
  ],
};

/** A route under `pages/api`, which is the Express handler again: `(req, res) => res.status(200).json(x)`. */
export const PAGES_API_REQUEST: RequestReadingDescription = EXPRESS_REQUEST;

/**
 * Medusa: an Express handler whose request carries what the route's validator
 * checked beside what arrived - `req.validatedBody`, `req.validatedQuery` -
 * and which is the part when it is there.
 */
export const MEDUSA_REQUEST: RequestReadingDescription = {
  parts: {
    body: [
      { param: 0, at: ['validatedBody'] },
      { param: 0, at: ['body'] },
    ],
    params: [{ param: 0, at: ['params'] }],
    query: [
      { param: 0, at: ['validatedQuery'] },
      { param: 0, at: ['query'] },
    ],
  },
  answers: [{ by: 'call', param: 1, methods: ['json', 'send'], statusMethods: ['status'] }],
  defaults: [NODE_HEADERS, 'ParamsDictionary', 'ParsedQs'],
};
