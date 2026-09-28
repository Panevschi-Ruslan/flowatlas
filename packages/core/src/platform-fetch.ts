import type { CallExpression, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { originOfValue } from './origin.js';
import { evaluateExpression } from './static-value.js';

/**
 * The platform's own request client, described once for every reader.
 *
 * `fetch` belongs to no framework. A front end with no client of its own calls
 * it, and so does a service in a framework whose own injected client it never
 * used, and both mean the same request by it. One front-end reader knew this and
 * the other did not, so a `fetch('/orders', { method: 'POST' })` in the second
 * was read as nothing at all — no request, no row — and the route it posts to
 * was reported uncalled in silence (R140). Two readers each keeping a copy is
 * how that happens: the one written second forgets. So the description lives
 * here, below both, and each reader asks it rather than knowing (I12 keeps one
 * extractor from reaching into another).
 *
 * Only what the platform decides is here: where the address, the options and
 * the body sit, which option names the verb, and what a call with no options
 * sends. What either reader then does with an address is its own.
 */
export interface OptionsRequestShape {
  /** How the client is named in `meta.client` and in every row. */
  readonly name: string;
  /** The names the client is called by. */
  readonly names: readonly string[];
  readonly urlAt: number;
  /** The options object, which is where the verb and the body are written. */
  readonly optionsAt: number;
  /** The option naming the verb. */
  readonly verbKey: string;
  /** The option holding the body. */
  readonly bodyKey: string;
  /**
   * What a call with no options at all sends: the protocol's own default, and
   * therefore a fact rather than a guess. A call handed options assembled
   * elsewhere is different, and gets no verb.
   */
  readonly defaultVerb: string;
  /**
   * Calls that turn a value into the body without changing what it describes.
   *
   * The browser's client takes a string, so a repository writes
   * `body: JSON.stringify(order)`, and the shape worth recording is the order.
   */
  readonly serialisers: readonly string[];
}

export const PLATFORM_FETCH: OptionsRequestShape = {
  name: 'fetch',
  names: ['fetch'],
  urlAt: 0,
  optionsAt: 1,
  verbKey: 'method',
  bodyKey: 'body',
  defaultVerb: 'GET',
  serialisers: ['stringify'],
};

/**
 * Whether a bare name stands for something the platform provides.
 *
 * The name alone proves nothing: `fetch` is the most commonly shadowed name in
 * a front end, because a repository that wraps it names the wrapper after it.
 * A function declared in the repository is that wrapper and is followed as
 * ordinary code. A name the checker will not resolve at all is accepted, since
 * there is no declaration for it to have missed: it is the ambient global in a
 * repository whose compiler settings leave the platform's library out.
 */
export const isPlatformProvided = (expression: TsNode): boolean =>
  originOfValue(expression).kind !== 'local';

/** Whether a call is made on the platform's client by one of its own names. */
export const isPlatformRequest = (
  call: CallExpression,
  shape: OptionsRequestShape = PLATFORM_FETCH,
): boolean => {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) && shape.names.includes(callee.getText()) && isPlatformProvided(callee);
};

/** The object written in place at an argument, when one was. */
const objectAt = (call: CallExpression, index: number): ObjectLiteralExpression | undefined => {
  const argument = call.getArguments()[index];
  return argument !== undefined && Node.isObjectLiteralExpression(argument) ? argument : undefined;
};

/** The value written for a key of an object, when the object writes it. */
const valueOf = (object: ObjectLiteralExpression | undefined, key: string): TsNode | undefined => {
  const property = object?.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/**
 * The verb one call sends.
 *
 * Null means it was not read, which is a different thing from the default: a
 * call with no options is the protocol's default for certain, while a call
 * handed an options object assembled elsewhere could be anything and saying
 * `GET` about it would be an invention.
 */
export const requestVerbOf = (
  call: CallExpression,
  shape: OptionsRequestShape = PLATFORM_FETCH,
): string | null => {
  if (call.getArguments()[shape.optionsAt] === undefined) return shape.defaultVerb;
  const options = objectAt(call, shape.optionsAt);
  if (options === undefined) return null;
  const written = valueOf(options, shape.verbKey);
  if (written === undefined) return shape.defaultVerb;
  const value = evaluateExpression(written);
  return value.resolved && typeof value.value === 'string' ? value.value.toUpperCase() : null;
};

/** The value one call sends as its body, looked through its serialisation. */
export const requestBodyOf = (
  call: CallExpression,
  shape: OptionsRequestShape = PLATFORM_FETCH,
): TsNode | undefined => {
  const written = valueOf(objectAt(call, shape.optionsAt), shape.bodyKey);
  if (written === undefined || !Node.isCallExpression(written)) return written;
  const callee = written.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !shape.serialisers.includes(callee.getName())) return written;
  return written.getArguments()[0] ?? written;
};
