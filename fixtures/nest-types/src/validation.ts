// Local stand-in for `class-validator` and `class-transformer`.
//
// Neither package is installed for the fixtures, and the extractor only reads
// the decorator *names* and their literal arguments (P02 §5 `nestFieldMetaReader`),
// so a no-op factory carrying the real name is enough: the fixture needs no
// install and still carries every decorator fact the reader must pick up.
//
// Every factory is typed `(...args: any[]) => any` so it type-checks in any
// decorator position (property, parameter, class).

export type DecoratorFactory = (...args: any[]) => any;

const noop: DecoratorFactory = () => () => undefined;

// class-validator
export const IsString: DecoratorFactory = noop;
export const IsOptional: DecoratorFactory = noop;
export const IsInt: DecoratorFactory = noop;
export const ValidateNested: DecoratorFactory = noop;
export const ArrayNotEmpty: DecoratorFactory = noop;

// class-transformer
export const Expose: DecoratorFactory = noop;
export const Exclude: DecoratorFactory = noop;
export const Transform: DecoratorFactory = noop;
export const Type: DecoratorFactory = noop;
