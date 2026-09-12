import { Project, type ClassDeclaration } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNestFieldMetaReader, nestFieldMetaReader } from './field-meta-reader.js';

const DECORATORS = `
export const IsString = (...a: any[]) => (...b: any[]) => undefined;
export const IsInt = (...a: any[]) => (...b: any[]) => undefined;
export const IsOptional = (...a: any[]) => (...b: any[]) => undefined;
export const ValidateNested = (...a: any[]) => (...b: any[]) => undefined;
export const ArrayNotEmpty = (...a: any[]) => (...b: any[]) => undefined;
export const Expose = (...a: any[]) => (...b: any[]) => undefined;
export const Exclude = (...a: any[]) => (...b: any[]) => undefined;
export const Transform = (...a: any[]) => (...b: any[]) => undefined;
export const Type = (...a: any[]) => (...b: any[]) => undefined;
`;

const OTHER = `export const Type = (...a: any[]) => (...b: any[]) => undefined;`;

const SOURCE = `
import { IsString, IsInt, IsOptional, ValidateNested, ArrayNotEmpty, Expose, Exclude, Transform, Type } from './decorators.js';
import { Type as OtherType } from 'unrelated-package';

export class Item { name!: string }

export class Dto {
  @Expose({ name: 'customer_id' })
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  note!: string;

  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => Item)
  items!: Item[];

  @Exclude()
  secret!: string;

  @Transform(({ value }: any) => String(value))
  coupon!: string;

  @IsInt()
  quantity!: number;

  @OtherType(() => Item)
  unrelated!: string;

  plain!: string;
}

export interface Plain { a: string }
`;

describe('reading validation and serialisation annotations', () => {
  let dto: ClassDeclaration;

  beforeAll(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('decorators.ts', DECORATORS);
    project.createSourceFile('node_modules/unrelated-package/index.d.ts', OTHER);
    const file = project.createSourceFile('dto.ts', SOURCE);
    dto = file.getClassOrThrow('Dto');
  });

  const read = (name: string) => nestFieldMetaReader.read(dto.getPropertyOrThrow(name));

  it('records the validators applied to a field', () => {
    expect(read('customerId').meta?.['validators']).toEqual(['IsString']);
    expect(read('quantity').meta?.['validators']).toEqual(['IsInt']);
  });

  it('treats an optional annotation as making the field optional', () => {
    const result = read('note');
    expect(result.optional).toBe(true);
    expect(result.meta?.['validators']).toEqual(['IsOptional', 'IsString']);
  });

  it('records a field renamed on the wire', () => {
    expect(read('customerId').meta).toMatchObject({ expose: true, exposeAs: 'customer_id' });
  });

  it('records a field dropped on the wire', () => {
    expect(read('secret').meta).toMatchObject({ exclude: true });
  });

  it('records a field whose value is rewritten', () => {
    expect(read('coupon').meta).toMatchObject({ transform: true });
  });

  it('records the class a nested field is deserialised into', () => {
    const result = read('items');
    expect(result.meta).toMatchObject({ validateNested: true });
    expect(result.meta?.['typeFn']).toBe('Item');
    expect(result.meta?.['validators']).toEqual(['ArrayNotEmpty', 'ValidateNested']);
  });

  it('resolves the nested class to a reference when it can', () => {
    const reader = createNestFieldMetaReader({ resolveTypeRef: () => 'type:orders#Item' });
    expect(reader.read(dto.getPropertyOrThrow('items')).meta?.['typeFn']).toBe('type:orders#Item');
  });

  it('ignores a decorator of the same name from an unrelated package', () => {
    expect(read('unrelated').meta?.['typeFn']).toBeUndefined();
  });

  it('says nothing about a field with no annotations', () => {
    expect(read('plain')).toEqual({});
  });

  it('says nothing about an interface member, which cannot carry any', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('plain.ts', 'export interface P { a: string }');
    const property = file.getInterfaceOrThrow('P').getPropertyOrThrow('a');
    expect(nestFieldMetaReader.read(property)).toEqual({});
  });
});

describe('deciding which annotations to believe', () => {
  const project = new Project({ useInMemoryFileSystem: true });

  beforeAll(() => {
    project.createSourceFile(
      'node_modules/class-validator/index.d.ts',
      'export declare const BrandNewRule: (...a: any[]) => any;\nexport declare const IsString: (...a: any[]) => any;',
    );
    project.createSourceFile(
      'node_modules/some-orm/index.d.ts',
      'export declare const IsString: (...a: any[]) => any;\nexport declare const Length: (...a: any[]) => any;',
    );
    project.createSourceFile(
      'from-library.ts',
      `import { BrandNewRule, IsString } from 'class-validator';
       export class A { @BrandNewRule() @IsString() a!: string }`,
    );
    project.createSourceFile(
      'from-elsewhere.ts',
      `import { IsString, Length } from 'some-orm';
       export class B { @IsString() @Length(3) b!: string }`,
    );
  });

  it('believes any decorator that came from the library itself', () => {
    const property = project
      .getSourceFileOrThrow('from-library.ts')
      .getClassOrThrow('A')
      .getPropertyOrThrow('a');
    expect(nestFieldMetaReader.read(property).meta?.['validators']).toEqual([
      'BrandNewRule',
      'IsString',
    ]);
  });

  it('ignores a decorator of the same name from an unrelated package', () => {
    const property = project
      .getSourceFileOrThrow('from-elsewhere.ts')
      .getClassOrThrow('B')
      .getPropertyOrThrow('b');
    expect(nestFieldMetaReader.read(property)).toEqual({});
  });
});
