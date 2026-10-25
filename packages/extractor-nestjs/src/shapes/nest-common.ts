/**
 * The part of Nest's common package a reading leans on: the decorators that
 * make a class a module, a controller or a provider, the ones that say what a
 * handler is handed, and the types a module and a guard are written against.
 *
 * Written by hand from the framework's documented surface. The signatures are
 * loose where a reading does not look (options are `unknown`, and so are most
 * decorator arguments) and exact where it does: `DynamicModule` names its
 * `providers`, and `Type<T>` is a constructor so that an injected class is
 * still the class it names.
 */
export const NEST_COMMON_SHAPE = `
import type { Observable } from 'rxjs';

export interface Type<T = any> extends Function { new (...args: any[]): T; }
export type Abstract<T> = abstract new (...args: any[]) => T;
export type InjectionToken<T = any> = string | symbol | Type<T> | Abstract<T> | Function;
export interface ForwardReference<T = any> { forwardRef: T; }
export type Provider<T = any> =
  | Type<T>
  | { provide: InjectionToken; useClass: Type<T> }
  | { provide: InjectionToken; useValue: T }
  | { provide: InjectionToken; useFactory: (...args: any[]) => T | Promise<T>; inject?: unknown[] }
  | { provide: InjectionToken; useExisting: unknown };
export interface DynamicModule extends ModuleMetadata {
  module: Type<any>;
  global?: boolean;
}
export interface ModuleMetadata {
  imports?: Array<Type<any> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
  controllers?: Type<any>[];
  providers?: Provider[];
  exports?: Array<InjectionToken | Provider | DynamicModule | ForwardReference>;
}
export interface ExecutionContext {
  getClass<T = any>(): Type<T>;
  getHandler(): Function;
  getType<T extends string = string>(): T;
  switchToHttp(): { getRequest<T = any>(): T; getResponse<T = any>(): T; getNext<T = any>(): T };
  switchToRpc(): { getData<T = any>(): T; getContext<T = any>(): T };
}
export interface CallHandler<T = any> { handle(): Observable<T>; }
export interface ArgumentMetadata { type: string; metatype?: Type<unknown>; data?: string; }
export interface ArgumentsHost { getArgs<T extends any[] = any[]>(): T; getType<T extends string = string>(): T; }
export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean>;
}
export interface NestInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<R> | Promise<Observable<R>>;
}
export interface PipeTransform<T = any, R = any> { transform(value: T, metadata: ArgumentMetadata): R; }
export interface NestMiddleware<TRequest = any, TResponse = any> {
  use(req: TRequest, res: TResponse, next: (error?: unknown) => void): unknown;
}
export interface ExceptionFilter<T = any> { catch(exception: T, host: ArgumentsHost): unknown; }
export interface MiddlewareConsumer {
  apply(...middleware: unknown[]): { exclude(...routes: unknown[]): unknown; forRoutes(...routes: unknown[]): MiddlewareConsumer };
}
export interface NestModule { configure(consumer: MiddlewareConsumer): unknown; }
export interface OnModuleInit { onModuleInit(): unknown; }
export interface OnModuleDestroy { onModuleDestroy(): unknown; }
export interface OnApplicationBootstrap { onApplicationBootstrap(): unknown; }
export interface OnApplicationShutdown { onApplicationShutdown(signal?: string): unknown; }
export interface INestApplication {
  listen(port: number | string, hostname?: string): Promise<unknown>;
  setGlobalPrefix(prefix: string, options?: unknown): this;
  useGlobalGuards(...guards: CanActivate[]): this;
  useGlobalInterceptors(...interceptors: NestInterceptor[]): this;
  useGlobalPipes(...pipes: PipeTransform[]): this;
  useGlobalFilters(...filters: ExceptionFilter[]): this;
  use(...args: unknown[]): this;
  enableCors(options?: unknown): void;
  get<T = any>(token: InjectionToken<T>): T;
  connectMicroservice<T extends object = any>(options: T): unknown;
  startAllMicroservices(): Promise<this>;
  close(): Promise<void>;
}

export declare function Module(metadata: ModuleMetadata): ClassDecorator;
export declare function Global(): ClassDecorator;
export declare function Injectable(options?: unknown): ClassDecorator;
export declare function Controller(prefixOrOptions?: string | string[] | { path?: string | string[]; host?: unknown; version?: unknown }): ClassDecorator;
export declare function Inject(token?: InjectionToken | ForwardReference): PropertyDecorator & ParameterDecorator;
export declare function Optional(): PropertyDecorator & ParameterDecorator;
export declare function forwardRef<T = any>(fn: () => T): ForwardReference<T>;

export declare function Get(path?: string | string[]): MethodDecorator;
export declare function Post(path?: string | string[]): MethodDecorator;
export declare function Put(path?: string | string[]): MethodDecorator;
export declare function Patch(path?: string | string[]): MethodDecorator;
export declare function Delete(path?: string | string[]): MethodDecorator;
export declare function Options(path?: string | string[]): MethodDecorator;
export declare function Head(path?: string | string[]): MethodDecorator;
export declare function All(path?: string | string[]): MethodDecorator;
export declare function Sse(path?: string): MethodDecorator;
export declare function HttpCode(statusCode: number): MethodDecorator;
export declare function Header(name: string, value: string): MethodDecorator;
export declare function Redirect(url?: string, statusCode?: number): MethodDecorator;
export declare function Version(version: string | string[]): MethodDecorator & ClassDecorator;
export declare function SetMetadata<K = string, V = any>(key: K, value: V): MethodDecorator & ClassDecorator;
export declare function UseGuards(...guards: unknown[]): MethodDecorator & ClassDecorator;
export declare function UseInterceptors(...interceptors: unknown[]): MethodDecorator & ClassDecorator;
export declare function UsePipes(...pipes: unknown[]): MethodDecorator & ClassDecorator;
export declare function UseFilters(...filters: unknown[]): MethodDecorator & ClassDecorator;
export declare function Catch(...exceptions: unknown[]): ClassDecorator;

export declare function Body(property?: string, ...pipes: unknown[]): ParameterDecorator;
export declare function Param(property?: string, ...pipes: unknown[]): ParameterDecorator;
export declare function Query(property?: string, ...pipes: unknown[]): ParameterDecorator;
export declare function Headers(property?: string): ParameterDecorator;
export declare function Req(): ParameterDecorator;
export declare function Request(): ParameterDecorator;
export declare function Res(options?: { passthrough: boolean }): ParameterDecorator;
export declare function Response(options?: { passthrough: boolean }): ParameterDecorator;
export declare function Next(): ParameterDecorator;
export declare function Ip(): ParameterDecorator;
export declare function HostParam(property?: string): ParameterDecorator;
export declare function UploadedFile(fileKey?: string, ...pipes: unknown[]): ParameterDecorator;
export declare function UploadedFiles(...pipes: unknown[]): ParameterDecorator;
export declare function createParamDecorator<T = any>(factory: (data: T, context: ExecutionContext) => unknown): (data?: T, ...pipes: unknown[]) => ParameterDecorator;
export declare function applyDecorators(...decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator>): <T>(target: object | Type<T>, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void;

export declare enum RequestMethod { GET = 0, POST = 1, PUT = 2, DELETE = 3, PATCH = 4, ALL = 5, OPTIONS = 6, HEAD = 7 }
export declare enum HttpStatus {
  OK = 200, CREATED = 201, ACCEPTED = 202, NO_CONTENT = 204,
  BAD_REQUEST = 400, UNAUTHORIZED = 401, FORBIDDEN = 403, NOT_FOUND = 404, CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422, INTERNAL_SERVER_ERROR = 500, BAD_GATEWAY = 502, SERVICE_UNAVAILABLE = 503
}

export declare class HttpException extends Error {
  constructor(response: string | Record<string, any>, status: number, options?: unknown);
  getResponse(): string | object;
  getStatus(): number;
}
export declare class BadRequestException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class UnauthorizedException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class ForbiddenException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class NotFoundException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class ConflictException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class UnprocessableEntityException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }
export declare class InternalServerErrorException extends HttpException { constructor(objectOrError?: unknown, description?: unknown); }

export declare class Logger {
  constructor(context?: string, options?: unknown);
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  verbose(message: unknown, ...optionalParams: unknown[]): void;
}
export declare class ValidationPipe implements PipeTransform {
  constructor(options?: unknown);
  transform(value: any, metadata: ArgumentMetadata): any;
}
export declare class ParseIntPipe implements PipeTransform<string, number> {
  constructor(options?: unknown);
  transform(value: string, metadata: ArgumentMetadata): number;
}
export declare class ParseUUIDPipe implements PipeTransform<string, string> {
  constructor(options?: unknown);
  transform(value: string, metadata: ArgumentMetadata): string;
}
`;
