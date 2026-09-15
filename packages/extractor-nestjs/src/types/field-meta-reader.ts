import type { FieldDeclaration, FieldMetaReader, FieldMetaResult } from '@flowatlas/core';
import type { Decorator, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { decoratorArgs, decoratorModule, decoratorName } from '@flowatlas/core';

/**
 * Validation and serialisation annotations.
 *
 * These libraries change what a type looks like once it leaves the process: a
 * field can be renamed, dropped, or made optional in a way the type system never
 * sees. What each annotation says is recorded here; deciding what it means for
 * two services agreeing with each other happens later.
 */

const VALIDATOR_PACKAGE = 'class-validator';
const TRANSFORMER_PACKAGE = 'class-transformer';

/**
 * The validation library's decorators.
 *
 * Listed rather than pattern-matched, so that a decorator the list does not know
 * is visible as an omission instead of being swept in by a name that happens to
 * start with the right letters. When the import source says the decorator came
 * from the library itself, the list is not consulted at all.
 */
const VALIDATOR_NAMES = new Set([
  'Allow', 'Equals', 'IsDefined', 'IsEmpty', 'IsIn', 'IsNotEmpty', 'IsNotIn', 'IsOptional',
  'NotEquals', 'Validate', 'ValidateBy', 'ValidateIf', 'ValidateNested', 'ValidatePromise',
  'IsArray', 'IsBoolean', 'IsDate', 'IsEnum', 'IsInt', 'IsNumber', 'IsObject', 'IsString',
  'IsDivisibleBy', 'IsNegative', 'IsPositive', 'Max', 'Min', 'MaxDate', 'MinDate',
  'IsBooleanString', 'IsDateString', 'IsNumberString',
  'Contains', 'NotContains', 'IsAlpha', 'IsAlphanumeric', 'IsAscii', 'IsBase32', 'IsBase64',
  'IsBIC', 'IsBtcAddress', 'IsByteLength', 'IsCreditCard', 'IsCurrency', 'IsDataURI',
  'IsDecimal', 'IsEAN', 'IsEmail', 'IsEthereumAddress', 'IsFQDN', 'IsFirebasePushId',
  'IsFullWidth', 'IsHSL', 'IsHalfWidth', 'IsHash', 'IsHexColor', 'IsHexadecimal',
  'IsIBAN', 'IsIP', 'IsISBN', 'IsISIN', 'IsISO31661Alpha2', 'IsISO31661Alpha3',
  'IsISO8601', 'IsISRC', 'IsISSN', 'IsIdentityCard', 'IsJSON', 'IsJWT', 'IsLatLong',
  'IsLatitude', 'IsLocale', 'IsLongitude', 'IsLowercase', 'IsMACAddress', 'IsMagnetURI',
  'IsMilitaryTime', 'IsMimeType', 'IsMobilePhone', 'IsMongoId', 'IsMultibyte',
  'IsNumberString', 'IsOctal', 'IsPassportNumber', 'IsPhoneNumber', 'IsPort',
  'IsPostalCode', 'IsRFC3339', 'IsRgbColor', 'IsSemVer', 'IsStrongPassword',
  'IsSurrogatePair', 'IsTimeZone', 'IsUUID', 'IsUppercase', 'IsUrl', 'IsVariableWidth',
  'Length', 'MaxLength', 'Matches', 'MinLength',
  'ArrayContains', 'ArrayMaxSize', 'ArrayMinSize', 'ArrayNotContains', 'ArrayNotEmpty',
  'ArrayUnique', 'IsInstance',
]);

const TRANSFORMER_NAMES = new Set(['Expose', 'Exclude', 'Transform', 'Type']);

/**
 * Whether an annotation with one of these names should be believed.
 *
 * Accepted when it comes from one of the two libraries, from a relative import
 * (a local re-export or a stand-in), or from a source the checker could not
 * follow. Rejected only when it demonstrably comes from an unrelated package,
 * which is what stops an unrelated `@Type` from being read as a serialisation
 * hint.
 */
const sourceOf = (decorator: Decorator): 'validator' | 'transformer' | 'unknown' | 'other' => {
  const module = decoratorModule(decorator);
  if (module === VALIDATOR_PACKAGE) return 'validator';
  if (module === TRANSFORMER_PACKAGE) return 'transformer';
  if (module === undefined || module.startsWith('.') || module.startsWith('/')) return 'unknown';
  return 'other';
};

const isPlausibleSource = (decorator: Decorator): boolean => {
  const module = decoratorModule(decorator);
  if (module === undefined) return true;
  if (module === VALIDATOR_PACKAGE || module === TRANSFORMER_PACKAGE) return true;
  return module.startsWith('.') || module.startsWith('/');
};

export interface NestFieldMetaOptions {
  /** Turns the class named by `@Type(() => X)` into a reference. */
  resolveTypeRef?: (node: TsNode) => string | undefined;
}

/** The class named inside `@Type(() => X)`. */
const arrowTarget = (decorator: Decorator): TsNode | undefined => {
  const [argument] = decorator.getArguments();
  if (argument === undefined || !Node.isArrowFunction(argument)) return undefined;
  const body = argument.getBody();
  return Node.isIdentifier(body) ? body : undefined;
};

export const createNestFieldMetaReader = (
  options: NestFieldMetaOptions = {},
): FieldMetaReader => ({
  name: 'nestjs-validation',
  read: (property: FieldDeclaration): FieldMetaResult => {
    const validators: string[] = [];
    const meta: Record<string, unknown> = {};
    let optional = false;

    // Only a class property can carry annotations; an interface member cannot.
    const decorators = Node.isPropertyDeclaration(property) ? property.getDecorators() : [];
    for (const decorator of decorators) {
      const name = decoratorName(decorator);
      const source = sourceOf(decorator);
      if (source === 'other') continue;

      if (source !== 'validator' && TRANSFORMER_NAMES.has(name)) {
        if (name === 'Exclude') meta['exclude'] = true;
        if (name === 'Transform') meta['transform'] = true;
        if (name === 'Expose') {
          meta['expose'] = true;
          const [first] = decoratorArgs(decorator);
          if (first?.resolved === true && typeof first.value === 'object' && first.value !== null) {
            const exposeAs = (first.value as { name?: unknown }).name;
            if (typeof exposeAs === 'string') meta['exposeAs'] = exposeAs;
          }
        }
        if (name === 'Type') {
          const target = arrowTarget(decorator);
          const ref = target === undefined ? undefined : options.resolveTypeRef?.(target);
          meta['typeFn'] = ref ?? target?.getText() ?? true;
        }
        continue;
      }

      // From the library itself, every decorator counts. From a source that
      // cannot be read, only the ones the list knows — but one it does not know
      // may be a validator of the project's own, built with `registerDecorator`,
      // and saying so keeps a check about validation from assuming there is none.
      if (source !== 'validator' && !VALIDATOR_NAMES.has(name)) {
        const seen = Array.isArray(meta['unclassified']) ? (meta['unclassified'] as string[]) : [];
        meta['unclassified'] = [...seen, name];
        continue;
      }
      validators.push(name);
      if (name === 'IsOptional') optional = true;
      if (name === 'ValidateNested') meta['validateNested'] = true;
      const [first] = decoratorArgs(decorator);
      if (first?.resolved === true && typeof first.value === 'object' && first.value !== null) {
        const groups = (first.value as { groups?: unknown }).groups;
        if (Array.isArray(groups)) meta['groups'] = groups;
      }
    }

    if (validators.length > 0) meta['validators'] = validators;
    return {
      ...(optional ? { optional } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  },
});

export const nestFieldMetaReader = createNestFieldMetaReader();
