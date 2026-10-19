/**
 * The part of Nest's passport package a reading leans on: `AuthGuard(type)`,
 * the guard factory a route is put behind, so that an uninstalled clone still
 * sees the guard and what it refuses with (401, see `failures/statuses.ts`).
 *
 * Written by hand from the framework's documented surface.
 */
export const NEST_PASSPORT_SHAPE = `
import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';

export interface IAuthGuard extends CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
  handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext, status?: any): TUser;
  getAuthenticateOptions(context: ExecutionContext): Record<string, any> | undefined;
}
export declare const AuthGuard: (type?: string | string[]) => Type<IAuthGuard>;
export declare abstract class PassportStrategy {}
export declare class PassportModule {
  static register(options: Record<string, any>): any;
}
`;
