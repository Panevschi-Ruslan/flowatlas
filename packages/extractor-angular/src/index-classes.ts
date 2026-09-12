import {
  buildClassIndex as buildIndex,
  ClassIndex,
  getDecorator,
  hasDecorator,
  type IndexedClass as CoreIndexedClass,
} from '@flowatlas/core';
import type { ClassDeclaration, Decorator, Project } from 'ts-morph';

/** Where this framework's own decorators come from. */
export const ANGULAR_CORE = ['@angular/core'] as const;

/** Where the HTTP client this extractor recognises is declared. */
export const ANGULAR_HTTP = '@angular/common/http';

/**
 * What a class is, as far as the graph is concerned.
 *
 * Decided once, before any pass runs, so that whichever pass reaches a class
 * first creates the same node for it. `plain` covers everything the graph has no
 * node type for, directives and pipes among them.
 */
export type AngularRole = 'component' | 'module' | 'injectable' | 'plain';

export type AngularClassIndex = ClassIndex<AngularRole>;
export type IndexedClass = CoreIndexedClass<AngularRole>;

const roleOf = (declaration: ClassDeclaration): AngularRole => {
  if (hasDecorator(declaration, 'Component', ANGULAR_CORE)) return 'component';
  if (hasDecorator(declaration, 'NgModule', ANGULAR_CORE)) return 'module';
  if (hasDecorator(declaration, 'Injectable', ANGULAR_CORE)) return 'injectable';
  return 'plain';
};

export interface BuildClassIndexOptions {
  project: Project;
  repo: string;
  repoDir: string;
}

export const buildAngularClassIndex = (options: BuildClassIndexOptions): AngularClassIndex =>
  buildIndex<AngularRole>({ ...options, roleOf });

/** The decorator that makes a class a component, when it carries one. */
export const componentDecorator = (declaration: ClassDeclaration): Decorator | undefined =>
  getDecorator(declaration, 'Component', ANGULAR_CORE);

/** The decorator that makes a class a module, when it carries one. */
export const moduleDecorator = (declaration: ClassDeclaration): Decorator | undefined =>
  getDecorator(declaration, 'NgModule', ANGULAR_CORE);

/** The decorator that puts a class in the container, when it carries one. */
export const injectableDecorator = (declaration: ClassDeclaration): Decorator | undefined =>
  getDecorator(declaration, 'Injectable', ANGULAR_CORE);

export { ClassIndex };
