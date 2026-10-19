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
