/**
 * The part of Nest's core package a bootstrap file is written against: the
 * factory that makes an application, and the ways a provider is registered for
 * the whole application. Written by hand from the documented surface.
 */
export const NEST_CORE_SHAPE = `
import type { INestApplication, Type } from '@nestjs/common';

export declare const APP_GUARD = 'APP_GUARD';
export declare const APP_INTERCEPTOR = 'APP_INTERCEPTOR';
export declare const APP_PIPE = 'APP_PIPE';
export declare const APP_FILTER = 'APP_FILTER';

export declare class NestFactory {
  static create<T extends INestApplication = INestApplication>(module: Type<any> | unknown, options?: unknown): Promise<T>;
  static createMicroservice<T extends object = any>(module: Type<any> | unknown, options?: T): Promise<{ listen(): Promise<unknown>; close(): Promise<void> }>;
  static createApplicationContext(module: Type<any> | unknown, options?: unknown): Promise<{ get<T = any>(token: unknown): T; close(): Promise<void> }>;
}
export declare class Reflector {
  get<T = any>(metadataKey: unknown, target: unknown): T;
  getAllAndOverride<T = any>(metadataKey: unknown, targets: unknown[]): T;
}
export declare class ModuleRef {
  get<T = any>(token: unknown, options?: unknown): T;
  resolve<T = any>(token: unknown, contextId?: unknown, options?: unknown): Promise<T>;
}
`;
