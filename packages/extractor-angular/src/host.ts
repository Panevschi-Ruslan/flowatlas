import { evaluateExpression, getDecorator } from '@flowatlas/core';
import type { ClassDeclaration, Decorator, MethodDeclaration, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { ANGULAR_CORE } from './index-classes.js';
import { propertyOf } from './util/metadata.js';

/**
 * What a directive or component binds on the element it sits on (P45), each as
 * a template would write it: `[class.active]=isActive`, `(click)=toggle($event)`,
 * `role=button`.
 *
 * Read from both places Angular takes them: the decorator's `host` object, and
 * members decorated `@HostBinding` or `@HostListener`. One list, because to a
 * person reading the element they are one thing.
 *
 * A binding that calls a method of the class names it, so the method can be
 * pointed at (P50): `(mouseenter)=onEnter($event)` is `onEnter`.
 */

/** One binding as written, and the method of the class it calls, when it calls one. */
export interface HostBinding {
  readonly written: string;
  readonly method?: MethodDeclaration;
}

/** The method a listener's statement calls: `toggle($event)` is `toggle`. */
const CALLED = /^\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/;

const calledMethod = (declaration: ClassDeclaration, statement: string): MethodDeclaration | undefined => {
  const name = CALLED.exec(statement)?.[1];
  return name === undefined ? undefined : declaration.getMethod(name);
};

const bound = (written: string, method: MethodDeclaration | undefined): HostBinding =>
  method === undefined ? { written } : { written, method };

/** A string a decorator was handed, when it is one. */
const literalArgument = (decorator: Decorator, index: number): string | undefined => {
  const argument = decorator.getArguments()[index];
  if (argument === undefined) return undefined;
  const value = evaluateExpression(argument);
  return value.resolved && typeof value.value === 'string' ? value.value : undefined;
};

/** The arguments a listener hands its method, as written: `['$event']`. */
const listenerArguments = (decorator: Decorator): string => {
  const argument = decorator.getArguments()[1];
  if (argument === undefined || !Node.isArrayLiteralExpression(argument)) return '';
  return argument
    .getElements()
    .map((element) => {
      const value = evaluateExpression(element);
      return value.resolved && typeof value.value === 'string' ? value.value : element.getText();
    })
    .join(', ');
};

/**
 * How each member decorator reads, by its name: a binding sets a property of
 * the element from the member, a listener calls the member on an event.
 */
const MEMBER_BINDINGS: ReadonlyArray<readonly [decorator: string, read: (decorator: Decorator, member: string) => string]> = [
  ['HostBinding', (decorator, member) => `[${literalArgument(decorator, 0) ?? member}]=${member}`],
  ['HostListener', (decorator, member) => `(${literalArgument(decorator, 0) ?? '?'})=${member}(${listenerArguments(decorator)})`],
];

/** The `host` object's entries, each `key=value` as written; an `(event)` key's value may call a method. */
const hostObject = (declaration: ClassDeclaration, metadata: ObjectLiteralExpression | undefined): HostBinding[] => {
  const host = propertyOf(metadata, 'host');
  if (host === undefined || !Node.isObjectLiteralExpression(host)) return [];
  return host.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property)) return [];
    const nameNode = property.getNameNode();
    const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
    const written = property.getInitializer();
    const value = written === undefined ? undefined : evaluateExpression(written);
    if (value?.resolved !== true || typeof value.value !== 'string') return [];
    const method = key.startsWith('(') ? calledMethod(declaration, value.value) : undefined;
    return [bound(`${key}=${value.value}`, method)];
  });
};

/** Every host binding a class declares, in the order written: the object, then its members. */
export const hostBindingsOf = (declaration: ClassDeclaration, metadata: ObjectLiteralExpression | undefined): HostBinding[] => {
  const members = [...declaration.getProperties(), ...declaration.getGetAccessors(), ...declaration.getMethods()].sort(
    (a, b) => a.getStart() - b.getStart(),
  );
  const fromMembers = members.flatMap((member) =>
    MEMBER_BINDINGS.flatMap(([name, read]) => {
      const decorator = getDecorator(member, name, ANGULAR_CORE);
      if (decorator === undefined) return [];
      return [bound(read(decorator, member.getName()), Node.isMethodDeclaration(member) ? member : undefined)];
    }),
  );
  return [...hostObject(declaration, metadata), ...fromMembers];
};
