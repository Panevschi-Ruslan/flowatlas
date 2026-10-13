import {
  decoratorArgs,
  getDecorator,
  methodsOfClass,
  recordSignatures,
  recordStatedSignatures,
  type ClassMethod,
  type StatedPart,
  type StatedSignature,
} from '@flowatlas/core';
import { Node, type ClassDeclaration, type Decorator, type PropertyDeclaration, type Type } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { ANGULAR_CORE, type AngularRole } from '../index-classes.js';
import { definePass } from './types.js';

/** Every method of every class this reader indexed, by the id its node has. */
function* methodsOf(ctx: AngularExtractContext): Generator<readonly [string, ClassMethod]> {
  for (const indexed of ctx.classes.all()) {
    for (const method of methodsOfClass(indexed.declaration)) {
      const id = ctx.methodIdOf(method);
      if (id !== undefined) yield [id, method];
    }
  }
}

/** Which half of a component's signature a property is: what it is handed, or what it emits. */
type Side = 'input' | 'output';

/** A property read as one half of a component's signature: its name there, its type and whether it may be left out. */
interface Bound {
  side: Side;
  name: string;
  type: Type;
  optional: boolean;
}

/** The type a generic wrapper holds - `EventEmitter<Order>`, `InputSignal<string>` - or the type itself. */
const held = (type: Type): Type => type.getTypeArguments()[0] ?? type;

/** What a decorator is handed, where it could be read. */
const writtenTo = (decorator: Decorator): unknown[] =>
  decoratorArgs(decorator).flatMap((argument) => (argument.resolved ? [argument.value] : []));

/** The name a decorator gives a property in templates - `@Input('order')`, `{ alias }` - else its own. */
const aliasOf = (property: PropertyDeclaration, written: readonly unknown[]): string => {
  for (const value of written) {
    if (typeof value === 'string') return value;
    const alias = (value as { alias?: unknown } | undefined)?.alias;
    if (typeof alias === 'string') return alias;
  }
  return property.getName();
};

/**
 * How each spelling of an input or an output is read, by the decorator or the
 * function from `@angular/core` that makes it one (P35).
 *
 * `@Input() order: Order` is handed an `Order`, optional unless the options
 * say `required`; `@Output() saved = new EventEmitter<Order>()` emits an
 * `Order`. The signal functions say the same with the type they wrap:
 * `input<Order>()`, `input.required<Order>()`, `output<Order>()`, `model<T>()`.
 */
const DECORATED: Readonly<Record<string, (property: PropertyDeclaration) => Bound | undefined>> = {
  Input: (property) => {
    const decorator = getDecorator(property, 'Input', ANGULAR_CORE);
    if (decorator === undefined) return undefined;
    const written = writtenTo(decorator);
    const required = written.some((value) => (value as { required?: unknown } | undefined)?.required === true);
    return { side: 'input', name: aliasOf(property, written), type: property.getType(), optional: !required };
  },
  Output: (property) => {
    const decorator = getDecorator(property, 'Output', ANGULAR_CORE);
    if (decorator === undefined) return undefined;
    return { side: 'output', name: aliasOf(property, writtenTo(decorator)), type: held(property.getType()), optional: false };
  },
};

const SIGNALS: Readonly<Record<string, { side: Side; required: boolean }>> = {
  input: { side: 'input', required: false },
  'input.required': { side: 'input', required: true },
  model: { side: 'input', required: false },
  'model.required': { side: 'input', required: true },
  output: { side: 'output', required: false },
};

/**
 * Whether a name written at a call is imported from `@angular/core`, read off
 * the import in the file, so it holds with nothing installed.
 */
const fromAngular = (name: Node): boolean =>
  (name.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    if (!Node.isImportSpecifier(declaration)) return false;
    const module = declaration.getImportDeclaration().getModuleSpecifierValue();
    return ANGULAR_CORE.some((candidate) => candidate === module);
  });

const signalOf = (property: PropertyDeclaration): Bound | undefined => {
  const initializer = property.getInitializer();
  if (initializer === undefined || !Node.isCallExpression(initializer)) return undefined;
  const callee = initializer.getExpression();
  const spelled = SIGNALS[callee.getText()];
  const root = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
  if (spelled === undefined || !fromAngular(root)) return undefined;
  return { side: spelled.side, name: property.getName(), type: held(property.getType()), optional: spelled.side === 'input' && !spelled.required };
};

/** A component's inputs as what it takes, and its outputs as what it gives back. */
const componentSignature = (declaration: ClassDeclaration): StatedSignature => {
  const params: StatedPart[] = [];
  const fields: StatedPart[] = [];
  for (const property of declaration.getProperties()) {
    const bound = Object.values(DECORATED).reduce<Bound | undefined>((found, read) => found ?? read(property), undefined) ?? signalOf(property);
    if (bound === undefined) continue;
    const part: StatedPart = { name: bound.name, type: bound.type, site: property, ...(bound.optional ? { optional: true } : {}) };
    (bound.side === 'input' ? params : fields).push(part);
  }
  return { params, returns: { fields } };
};

/**
 * A pipe's `transform(value, ...args)`: what a template hands it, and what it
 * gives back (P40). A pipe without one says nothing.
 */
const pipeSignature = (declaration: ClassDeclaration): StatedSignature | undefined => {
  const transform = declaration.getMethod('transform');
  if (transform === undefined) return undefined;
  return {
    params: transform.getParameters().map((parameter) => ({
      name: parameter.getName(),
      type: parameter.getType(),
      site: parameter,
      ...(parameter.isOptional() || parameter.hasInitializer() ? { optional: true } : {}),
    })),
    returns: { type: transform.getReturnType(), site: transform },
  };
};

/**
 * How each role that has a signature of its own states it: a directive is
 * bound like a component, by its inputs and outputs.
 */
const STATED: Readonly<Partial<Record<AngularRole, (declaration: ClassDeclaration) => StatedSignature | undefined>>> = {
  component: componentSignature,
  directive: componentSignature,
  pipe: pipeSignature,
};

/** Every component, directive and pipe this reader indexed, with the signature it states. */
function* statedOf(ctx: AngularExtractContext): Generator<readonly [string, StatedSignature]> {
  for (const indexed of ctx.classes.all()) {
    const signature = STATED[indexed.role]?.(indexed.declaration);
    if (signature !== undefined) yield [indexed.id, signature];
  }
}

/**
 * What each method takes and gives back, what each component and directive is
 * handed and emits, and what each pipe transforms into what.
 *
 * Last, so that every edge into a method - a call from another one, and a
 * template event bound to it - is drawn before the method's types are written
 * on it. A template event then says what it hands its handler.
 */
export const signaturesPass = definePass('types', (ctx) => {
  recordSignatures(ctx.builder, ctx.types, methodsOf(ctx));
  recordStatedSignatures(ctx.builder, ctx.types, statedOf(ctx));
});
