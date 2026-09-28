import type { Node as TsNode, ParameterDeclaration, Type } from 'ts-morph';

/**
 * Finding the message inside the value a transport actually moves.
 *
 * The two ends of a channel are described separately and neither of them is
 * obliged to point at the same thing: a publishing call may take a record
 * holding the name, the options and the message, while the handler at the other
 * end is given only the message - or the other way round, a handler given the
 * library's envelope while the call took the message plainly. `payloadPath` is
 * how each end says which of the two it names, and this is the one place that
 * walks it, so the two ends cannot come to walk it differently.
 */

/**
 * The type at a path of properties, or nothing when the path does not fit.
 *
 * Nothing rather than the value it started from, deliberately. A description
 * saying the message sits at `data` does not fit a value with no `data`, and
 * answering with the wrapper would be the false statement this exists to stop:
 * an unknown payload is a row saying so, and a wrong one is a row accusing
 * somebody's handler of requiring fields nobody sends (R133).
 */
export const typeAtPath = (
  type: Type,
  path: readonly string[],
  site: TsNode,
): Type | undefined => {
  let current: Type = type;
  for (const key of path) {
    const property = current.getProperty(key);
    if (property === undefined) return undefined;
    current = property.getTypeAtLocation(site);
  }
  return current;
};

/**
 * The parameter a handler is given the message in.
 *
 * A decorator that marks it is asked first and a position answers otherwise,
 * because those are the two ways a transport has of saying which parameter is
 * the message, and a handler that writes the decorator may write its parameters
 * in any order.
 */
export const payloadParameter = (
  parameters: readonly ParameterDeclaration[],
  pattern: { payloadArg?: number; payloadDecorator?: string },
): ParameterDeclaration | undefined => {
  const marked =
    pattern.payloadDecorator === undefined
      ? undefined
      : parameters.find((parameter) =>
          parameter.getDecorators().some((decorator) => decorator.getName() === pattern.payloadDecorator),
        );
  return marked ?? parameters[pattern.payloadArg ?? 0];
};
