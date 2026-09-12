// Local stand-in for the validation and serialisation decorators.
//
// Neither package is installed for the fixtures, and the extractor reads only
// the decorator *names* and their literal arguments, so a no-op factory
// carrying the real name is enough: the fixture needs no install and still
// carries every decorator fact the reader has to pick up.

export type DecoratorFactory = (...args: any[]) => any;

const noop: DecoratorFactory = () => () => undefined;

export const IsString: DecoratorFactory = noop;
export const IsOptional: DecoratorFactory = noop;

export const Expose: DecoratorFactory = noop;
export const Exclude: DecoratorFactory = noop;
export const Transform: DecoratorFactory = noop;
