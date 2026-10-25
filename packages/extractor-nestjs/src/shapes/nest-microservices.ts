/**
 * The part of Nest's microservices package a reading leans on: the client a
 * service publishes through, the module that registers one under a token, and
 * the decorators a handler is subscribed with.
 *
 * Written by hand from the framework's documented surface. `ClientProxy` is a
 * class, not an interface, because a token registered by `ClientsModule` is
 * held as an instance of it (see `MODULE_TOKENS`), and `emit` / `send` keep
 * their `Observable<TResult>` so that what a call answers is still readable.
 */
export const NEST_MICROSERVICES_SHAPE = `
import type { DynamicModule, InjectionToken } from '@nestjs/common';
import type { Observable } from 'rxjs';

export declare enum Transport {
  TCP = 0, REDIS = 1, NATS = 2, MQTT = 3, GRPC = 4, RMQ = 5, KAFKA = 6
}
export interface ClientOptions { transport?: Transport; customClass?: unknown; options?: Record<string, any>; }
export type ClientProviderOptions = ClientOptions & { name: string | symbol };
export interface ClientsProviderAsyncOptions {
  name: string | symbol;
  imports?: unknown[];
  useFactory?: (...args: any[]) => ClientOptions | Promise<ClientOptions>;
  useClass?: unknown;
  useExisting?: unknown;
  inject?: InjectionToken[];
  extraProviders?: unknown[];
}
export type ClientsModuleOptions = ClientProviderOptions[] | { clients: ClientProviderOptions[]; isGlobal?: boolean };
export type ClientsModuleAsyncOptions = ClientsProviderAsyncOptions[] | { clients: ClientsProviderAsyncOptions[]; isGlobal?: boolean };
export type MicroserviceOptions = ClientOptions & Record<string, any>;

export declare abstract class ClientProxy {
  connect(): Promise<any>;
  close(): any;
  send<TResult = any, TInput = any>(pattern: any, data: TInput): Observable<TResult>;
  emit<TResult = any, TInput = any>(pattern: any, data: TInput): Observable<TResult>;
}
export declare class ClientProxyFactory {
  static create(clientOptions: ClientOptions): ClientProxy;
}
export declare class ClientsModule {
  static register(options: ClientsModuleOptions): DynamicModule;
  static registerAsync(options: ClientsModuleAsyncOptions): DynamicModule;
}
export declare class RpcException extends Error {
  constructor(error: string | object);
  getError(): string | object;
}

export declare function MessagePattern(metadata?: any, transport?: Transport, extras?: Record<string, any>): MethodDecorator;
export declare function EventPattern(metadata?: any, transport?: Transport, extras?: Record<string, any>): MethodDecorator;
export declare function Payload(property?: string, ...pipes: unknown[]): ParameterDecorator;
export declare function Ctx(): ParameterDecorator;
export declare function Client(metadata?: ClientOptions): PropertyDecorator;
`;
