import {
  buildClassIndex as buildIndex,
  ClassIndex,
  hasDecorator,
  type IndexedClass as CoreIndexedClass,
} from '@flowatlas/core';
import type { ClassDeclaration, Project } from 'ts-morph';

/**
 * What a class is, as far as the graph is concerned.
 *
 * Decided once, here, so that whichever pass happens to need a class first
 * creates it with the same node type. Otherwise a guard that is also a provider
 * would come out as whichever kind of node the earlier pass wanted.
 */
export type ClassRole =
  | 'module'
  | 'controller'
  | 'injectable'
  | 'guard'
  | 'interceptor'
  | 'pipe'
  | 'middleware'
  | 'plain';

export const NEST_COMMON = ['@nestjs/common'] as const;

/** Interface a class implements, and the role that implies. */
const ROLE_BY_INTERFACE: Record<string, ClassRole> = {
  CanActivate: 'guard',
  NestInterceptor: 'interceptor',
  PipeTransform: 'pipe',
  NestMiddleware: 'middleware',
  ExceptionFilter: 'plain',
};

/** The class index and its rows, fixed to the roles this extractor knows. */
export type NestClassIndex = ClassIndex<ClassRole>;
export type IndexedClass = CoreIndexedClass<ClassRole>;

const roleOf = (declaration: ClassDeclaration): ClassRole => {
  if (hasDecorator(declaration, 'Module', NEST_COMMON)) return 'module';
  if (hasDecorator(declaration, 'Controller', NEST_COMMON)) return 'controller';
  for (const implemented of declaration.getImplements()) {
    const role = ROLE_BY_INTERFACE[implemented.getExpression().getText()];
    if (role !== undefined && role !== 'plain') return role;
  }
  if (hasDecorator(declaration, 'Injectable', NEST_COMMON)) return 'injectable';
  return 'plain';
};

export interface BuildClassIndexOptions {
  project: Project;
  repo: string;
  repoDir: string;
}

/** Every class declared in the repository, with the role its decorators imply. */
export const buildClassIndex = (options: BuildClassIndexOptions): NestClassIndex =>
  buildIndex<ClassRole>({ ...options, roleOf });

export { ClassIndex };
