import { evaluateExpression, getDecorator } from '@flowatlas/core';
import type { ClassDeclaration, Decorator, ObjectLiteralExpression } from 'ts-morph';
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
 */

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

/** The `host` object's entries, each `key=value` as written. */
const hostObject = (metadata: ObjectLiteralExpression | undefined): string[] => {
  const host = propertyOf(metadata, 'host');
  if (host === undefined || !Node.isObjectLiteralExpression(host)) return [];
  return host.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property)) return [];
    const nameNode = property.getNameNode();
    const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
    const written = property.getInitializer();
    const value = written === undefined ? undefined : evaluateExpression(written);
    return value?.resolved === true && typeof value.value === 'string' ? [`${key}=${value.value}`] : [];
  });
};

/** Every host binding a class declares, in the order written: the object, then its members. */
export const hostBindingsOf = (declaration: ClassDeclaration, metadata: ObjectLiteralExpression | undefined): string[] => {
  const members = [...declaration.getProperties(), ...declaration.getGetAccessors(), ...declaration.getMethods()].sort(
    (a, b) => a.getStart() - b.getStart(),
  );
  const fromMembers = members.flatMap((member) =>
    MEMBER_BINDINGS.flatMap(([name, read]) => {
      const decorator = getDecorator(member, name, ANGULAR_CORE);
      return decorator === undefined ? [] : [read(decorator, member.getName())];
    }),
  );
  return [...hostObject(metadata), ...fromMembers];
};
