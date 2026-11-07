/**
 * Which module of the CDK an import names (P57).
 *
 * The app is read without its dependencies installed, so the checker cannot
 * say what `lambda.Function` is; the import says it instead. Every spelling the
 * CDK has had names the same module: `aws-cdk-lib/aws-lambda`, the library's
 * root with `aws_lambda` under it, version 1's `@aws-cdk/aws-lambda`, and the
 * `-alpha` packages a module starts out in. Each is reduced to the module's
 * own name, `aws-lambda`; the library's root - `App`, `Stack`, `Duration` - is
 * `core`, as version 1 called it, and `constructs` is the base of them all.
 */

/** The module an import from a package names, or `undefined` for a package that is not the CDK's. */
export const cdkModuleOf = (specifier: string): string | undefined => {
  if (specifier === 'aws-cdk-lib' || specifier === '@aws-cdk/core') return 'core';
  if (specifier === 'constructs') return 'constructs';
  const lib = /^aws-cdk-lib\/(.+)$/.exec(specifier);
  if (lib !== null) return (lib[1] as string).replace(/\/lib$/, '');
  const v1 = /^@aws-cdk\/(.+?)(?:-alpha)?$/.exec(specifier);
  if (v1 !== null) return v1[1] as string;
  return undefined;
};

/** Whether a package is Node's own path module, whose `join` and `resolve` are read. */
export const isPathModule = (specifier: string): boolean => specifier === 'path' || specifier === 'node:path';

/** The classes of the root and of `constructs` a construct of the app's own extends. */
export const CONSTRUCT_BASES: ReadonlySet<string> = new Set([
  'core.Stack',
  'core.NestedStack',
  'core.Stage',
  'core.Construct',
  'constructs.Construct',
]);

/** Whether a base is a stack, whose children are where the construct tree starts. */
export const isStackBase = (key: string): boolean => key === 'core.Stack' || key === 'core.NestedStack';
