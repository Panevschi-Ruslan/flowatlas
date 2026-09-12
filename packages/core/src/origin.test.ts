import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityNameOf, packageOfPath, resolveTypeOrigin, stripWrapperSuffix, unwrapDelivery } from './origin.js';

const SOURCE = `
import { Repository } from 'some-orm';
import { Client } from '@scope/driver';

export interface Order { id: string }
export class OrdersRepository { find(): Order[] { return [] } }
export class BaseRepository<Entity> { protected rows: Entity[] = [] }
export class OrdersStore extends BaseRepository<Order> {}
export class WrappedClient extends Client {}

export class Api {
  fromPackage!: Repository<Order>;
  scoped!: Client;
  local!: OrdersRepository;
  overBase!: OrdersStore;
  wrapping!: WrappedClient;
  awaited!: Promise<Repository<Order>>;
  plain!: string;
}
`;

const ORM = `export declare class Repository<Entity> { find(): Promise<Entity[]> }`;
const DRIVER = `export declare class Client { send(): void }`;

let file: SourceFile;

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/some-orm/index.d.ts', ORM);
  project.createSourceFile('node_modules/@scope/driver/index.d.ts', DRIVER);
  file = project.createSourceFile('api.ts', SOURCE);
});

describe('where a type came from', () => {

  const of = (property: string, options?: Parameters<typeof resolveTypeOrigin>[1]) =>
    resolveTypeOrigin(file.getClassOrThrow('Api').getPropertyOrThrow(property), options);

  it('names the package that declares the type', () => {
    expect(of('fromPackage')).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
  });

  it('keeps both segments of a scoped package', () => {
    expect(of('scoped')?.package).toBe('@scope/driver');
  });

  it('says a type declared here is local', () => {
    expect(of('local')).toMatchObject({ package: null, isLocal: true, typeName: 'OrdersRepository' });
  });

  it('reads the entity out of the type arguments', () => {
    const origin = of('fromPackage');
    expect(origin).not.toBeNull();
    if (origin !== null) expect(entityNameOf(origin)).toBe('Order');
  });

  it('sees through a promise', () => {
    expect(of('awaited')).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
  });

  it('recognises a base class named in the configuration', () => {
    expect(of('overBase', { localBaseClasses: ['BaseRepository'] })).toMatchObject({
      package: 'local:BaseRepository',
      isLocal: true,
    });
    const origin = of('overBase', { localBaseClasses: ['BaseRepository'] });
    if (origin !== null) expect(entityNameOf(origin)).toBe('Order');
  });

  it('leaves that base alone when the configuration does not name it', () => {
    expect(of('overBase')?.package).toBeNull();
  });

  it('follows a class of one own that wraps one from a package', () => {
    expect(of('wrapping')).toMatchObject({ package: '@scope/driver', typeName: 'Client' });
  });

  it('says nothing about a primitive', () => {
    expect(of('plain')).toBeNull();
  });
});

describe('packageOfPath', () => {
  it('reads the package out of a path', () => {
    expect(packageOfPath('/repo/node_modules/data-layer/index.d.ts')).toBe('data-layer');
  });

  it('keeps both segments of a scoped name', () => {
    expect(packageOfPath('/repo/node_modules/@scope/data/index.d.ts')).toBe('@scope/data');
  });

  it('takes the innermost package when a store nests them', () => {
    expect(
      packageOfPath('/repo/node_modules/.store/data-layer@0.3.20/node_modules/data-layer/index.d.ts'),
    ).toBe('data-layer');
  });

  it('says nothing about a path with no package in it', () => {
    expect(packageOfPath('/repo/src/orders.ts')).toBeNull();
  });
});

describe('stripWrapperSuffix', () => {
  it.each([
    ['OrderDocument', 'Order'],
    ['OrderEntity', 'Order'],
    ['OrderSchema', 'Order'],
    ['OrderModel', 'Order'],
    ['Order', 'Order'],
    ['Document', 'Document'],
  ])('turns %s into %s', (input, expected) => {
    expect(stripWrapperSuffix(input)).toBe(expected);
  });
});

describe('unwrapDelivery', () => {
  it('leaves a type that is not wrapped alone', () => {
    const property = file.getClassOrThrow('Api').getPropertyOrThrow('plain');
    expect(unwrapDelivery(property.getType()).getText()).toBe('string');
  });
});
