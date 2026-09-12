// Local stand-in for the validation and serialisation decorators.
//
// The same file as `orders/src/validation.ts`: the extractor reads decorator
// names and their literal arguments, so a no-op factory carrying the real name
// is all a fixture needs, and neither repository needs an install.

export type DecoratorFactory = (...args: any[]) => any;

const noop: DecoratorFactory = () => () => undefined;

export const IsString: DecoratorFactory = noop;
export const IsOptional: DecoratorFactory = noop;

export const Expose: DecoratorFactory = noop;
export const Exclude: DecoratorFactory = noop;
export const Transform: DecoratorFactory = noop;
