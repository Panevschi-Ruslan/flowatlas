/**
 * What NestJS answers a request with when something is thrown, as lookups.
 *
 * Pure data, kept apart from the reading so a new exception is one row and
 * nothing else changes.
 */

/** The package the built-in exceptions, guards and pipes come from. */
export const NEST_COMMON = '@nestjs/common';

/** What a service's manifest names when the framework answers its throws. */
export const NEST_PACKAGES: readonly string[] = ['@nestjs/core', NEST_COMMON];

/** The built-in exceptions, by class name, with the status each answers. */
export const EXCEPTION_STATUS: ReadonlyMap<string, number> = new Map([
  ['BadRequestException', 400],
  ['UnauthorizedException', 401],
  ['PaymentRequiredException', 402],
  ['ForbiddenException', 403],
  ['NotFoundException', 404],
  ['MethodNotAllowedException', 405],
  ['NotAcceptableException', 406],
  ['RequestTimeoutException', 408],
  ['ConflictException', 409],
  ['GoneException', 410],
  ['PreconditionFailedException', 412],
  ['PayloadTooLargeException', 413],
  ['UnsupportedMediaTypeException', 415],
  ['ImATeapotException', 418],
  ['MisdirectedException', 421],
  ['UnprocessableEntityException', 422],
  ['InternalServerErrorException', 500],
  ['NotImplementedException', 501],
  ['BadGatewayException', 502],
  ['ServiceUnavailableException', 503],
  ['GatewayTimeoutException', 504],
  ['HttpVersionNotSupportedException', 505],
]);

/** The exception that takes its status as the second argument. */
export const HTTP_EXCEPTION = 'HttpException';

/** Members of `HttpStatus`, by name. Only the ones a handler throws with. */
export const HTTP_STATUS: ReadonlyMap<string, number> = new Map([
  ['BAD_REQUEST', 400],
  ['UNAUTHORIZED', 401],
  ['PAYMENT_REQUIRED', 402],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  ['NOT_ACCEPTABLE', 406],
  ['REQUEST_TIMEOUT', 408],
  ['CONFLICT', 409],
  ['GONE', 410],
  ['PRECONDITION_FAILED', 412],
  ['PAYLOAD_TOO_LARGE', 413],
  ['UNSUPPORTED_MEDIA_TYPE', 415],
  ['I_AM_A_TEAPOT', 418],
  ['MISDIRECTED', 421],
  ['UNPROCESSABLE_ENTITY', 422],
  ['TOO_MANY_REQUESTS', 429],
  ['INTERNAL_SERVER_ERROR', 500],
  ['NOT_IMPLEMENTED', 501],
  ['BAD_GATEWAY', 502],
  ['SERVICE_UNAVAILABLE', 503],
  ['GATEWAY_TIMEOUT', 504],
  ['HTTP_VERSION_NOT_SUPPORTED', 505],
]);

/**
 * What anything else thrown becomes: the framework's own filter answers an
 * error it does not know with a 500.
 */
export const UNKNOWN_ERROR_STATUS = 500;

/** Thrown from a transport that has no status of its own to answer with. */
export const STATUSLESS_EXCEPTIONS: ReadonlySet<string> = new Set(['RpcException', 'WsException']);

/** What a refusal of a check looks like, by the layer the check is on. */
export interface Refusal {
  status: number;
  exception: string;
}

/** A guard that returns false: the framework throws this. */
export const GUARD_REFUSAL: Refusal = { status: 403, exception: 'ForbiddenException' };

/**
 * Checks from installed packages whose refusal is not the default, by package
 * then by class name.
 */
export const KNOWN_REFUSALS: ReadonlyMap<string, ReadonlyMap<string, Refusal>> = new Map([
  ['@nestjs/passport', new Map([['AuthGuard', { status: 401, exception: 'UnauthorizedException' }]])],
  [
    '@nestjs/throttler',
    new Map([['ThrottlerGuard', { status: 429, exception: 'ThrottlerException' }]]),
  ],
  [
    NEST_COMMON,
    new Map(
      [
        'ValidationPipe',
        'ParseIntPipe',
        'ParseFloatPipe',
        'ParseBoolPipe',
        'ParseArrayPipe',
        'ParseUUIDPipe',
        'ParseEnumPipe',
        'ParseDatePipe',
        'ParseFilePipe',
      ].map((name) => [name, { status: 400, exception: 'BadRequestException' }]),
    ),
  ],
]);

/** The refusal of a check from an installed package, if it is one known here. */
export const knownRefusal = (pkg: string | undefined, name: string): Refusal | undefined =>
  pkg === undefined ? undefined : KNOWN_REFUSALS.get(pkg)?.get(name);

/**
 * Functions that build the error a handler throws, and where each writes its
 * status (P233): `throw createError({ statusCode: 404 })`, Nitro's and Nuxt's,
 * imported from one of `packages` or global as Nuxt makes it. Read as a
 * failure of that status, named after the function, because the function is
 * what the code wrote.
 */
export interface ErrorFactory {
  readonly name: string;
  readonly packages: readonly string[];
  /** Keys of an options object, written first, that hold the status. */
  readonly statusKeys: readonly string[];
}

/** The frameworks whose handlers throw what an error factory builds: where the failures pass reads without NestJS. */
export const ERROR_FACTORY_FRAMEWORKS: readonly string[] = ['nuxt', 'nitropack', 'h3'];

export const ERROR_FACTORIES: readonly ErrorFactory[] = [
  { name: 'createError', packages: ['h3', 'nuxt/app', '#app', '#imports', 'nitropack/runtime'], statusKeys: ['statusCode', 'status'] },
];

/**
 * An error class a procedure framework throws, named by a code it is built
 * with rather than by a class per status (P58): `new ORPCError('NOT_FOUND')`,
 * `new TRPCError({ code: 'NOT_FOUND' })`. Read as a failure named after the
 * class and the code, at the status the framework answers the code with.
 */
export interface CodedError {
  readonly name: string;
  /** The argument the code is written in. */
  readonly codeAt: number;
  /** The key of that argument holding the code, where it is an options object. */
  readonly codeKey?: string;
  /** The argument and key where a status of its own may be written. */
  readonly statusAt?: number;
  readonly statusKey?: string;
  /** The status each code answers with. */
  readonly statuses: ReadonlyMap<string, number>;
  /** What a code the table does not name answers with. */
  readonly fallback: number;
}

/** The codes both procedure frameworks share, with the statuses they answer them with. */
const SHARED_CODES: ReadonlyArray<readonly [string, number]> = [
  ['BAD_REQUEST', 400],
  ['UNAUTHORIZED', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['METHOD_NOT_SUPPORTED', 405],
  ['TIMEOUT', 408],
  ['CONFLICT', 409],
  ['PRECONDITION_FAILED', 412],
  ['PAYLOAD_TOO_LARGE', 413],
  ['UNSUPPORTED_MEDIA_TYPE', 415],
  ['UNPROCESSABLE_CONTENT', 422],
  ['TOO_MANY_REQUESTS', 429],
  ['CLIENT_CLOSED_REQUEST', 499],
  ['INTERNAL_SERVER_ERROR', 500],
  ['NOT_IMPLEMENTED', 501],
  ['BAD_GATEWAY', 502],
  ['SERVICE_UNAVAILABLE', 503],
  ['GATEWAY_TIMEOUT', 504],
];

/** oRPC's codes: the shared ones and `NOT_ACCEPTABLE`; any other code answers 500 unless it writes a status. */
export const ORPC_CODES: ReadonlyMap<string, number> = new Map([...SHARED_CODES, ['NOT_ACCEPTABLE', 406]]);

/** tRPC's codes: the shared ones, a parse error and a payment one. */
export const TRPC_CODES: ReadonlyMap<string, number> = new Map([...SHARED_CODES, ['PARSE_ERROR', 400], ['PAYMENT_REQUIRED', 402]]);

export const CODED_ERRORS: readonly CodedError[] = [
  { name: 'ORPCError', codeAt: 0, statusAt: 1, statusKey: 'status', statuses: ORPC_CODES, fallback: UNKNOWN_ERROR_STATUS },
  { name: 'TRPCError', codeAt: 0, codeKey: 'code', statuses: TRPC_CODES, fallback: UNKNOWN_ERROR_STATUS },
];

/**
 * The failures a procedure declares are thrown through a helper its handler
 * is handed (P58): `({ errors }) => { throw errors.NOT_FOUND() }`. The name of
 * that member of the first parameter, and what a code answers with where the
 * declaration writes no status of its own.
 */
export const DECLARED_ERRORS = { parameter: 'errors', statuses: ORPC_CODES, fallback: UNKNOWN_ERROR_STATUS } as const;

/**
 * Packages whose procedures' failures are read where nothing else here is
 * (P58): their handlers answer a throw over HTTP with the status of its code,
 * whatever framework the rest of the service is written in. Only those ways in
 * are read.
 */
export const PROCEDURE_PACKAGES: readonly string[] = ['@orpc/server', '@trpc/server'];

/**
 * What each procedure reader's framework answers an input its schema refuses
 * with, by the reader's name (P58): the check runs before the handler, as a
 * pipe does.
 */
export const INPUT_REFUSALS: ReadonlyMap<string, Refusal> = new Map([
  ['orpc-procedures', { status: 400, exception: 'ORPCError(BAD_REQUEST)' }],
  ['trpc-procedures', { status: 400, exception: 'TRPCError(BAD_REQUEST)' }],
]);
