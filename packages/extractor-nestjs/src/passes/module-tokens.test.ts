import { Node, Project, type Expression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import type { NestExtractContext } from '../context.js';
import { tokensProvidedBy } from './module-tokens.js';

const ctx = { fileOf: () => 'src/app.module.ts' } as unknown as NestExtractContext;

/** The one expression `imports: [<text>]` would hold. */
const importOf = (text: string): Expression => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/repo/src/app.module.ts', `const imported = ${text};`);
  const initializer = file.getVariableDeclarationOrThrow('imported').getInitializerOrThrow();
  if (!Node.isExpression(initializer)) throw new Error('not an expression');
  return initializer;
};

const read = (text: string, typeName = 'ClientsModule', pkg = '@nestjs/microservices') =>
  tokensProvidedBy(importOf(text), { typeName, package: pkg }, ctx).map(({ token, kind }) => ({
    token,
    kind,
  }));

describe('the tokens a configured module provides (R150)', () => {
  it('takes each client a list registers, as the value Nest provides it with', () => {
    expect(
      read(`ClientsModule.register([
        { name: 'KAFKA_CLIENT', transport: Transport.KAFKA },
        { name: BILLING_CLIENT, transport: Transport.TCP },
      ])`),
    ).toEqual([
      { token: 'KAFKA_CLIENT', kind: 'useValue' },
      { token: 'BILLING_CLIENT', kind: 'useValue' },
    ]);
  });

  it('reads the list under `clients` too, and an async client as a factory', () => {
    expect(
      read(`ClientsModule.registerAsync({
        clients: [{ name: 'EVENTS_CLIENT', useFactory: () => ({}) }],
        isGlobal: true,
      })`),
    ).toEqual([{ token: 'EVENTS_CLIENT', kind: 'useFactory' }]);
  });

  it('takes a module that provides one token of its own whatever it is given', () => {
    expect(read('CacheModule.register({ ttl: 5 })', 'CacheModule', '@nestjs/cache-manager')).toEqual([
      { token: 'CACHE_MANAGER', kind: 'useFactory' },
    ]);
  });

  it('says which installed class the token holds', () => {
    const [client] = tokensProvidedBy(
      importOf(`ClientsModule.register([{ name: 'KAFKA_CLIENT' }])`),
      { typeName: 'ClientsModule', package: '@nestjs/microservices' },
      ctx,
    );
    expect(client?.holds).toEqual({ typeName: 'ClientProxy', package: '@nestjs/microservices' });
  });

  it('provides nothing for what no row describes', () => {
    expect(read(`ClientsModule.register([{ name: 'X' }])`, 'ClientsModule', 'my-own-clients')).toEqual([]);
    expect(read(`ClientsModule.forFeature([{ name: 'X' }])`)).toEqual([]);
    expect(read(`ClientsModule.toString([{ name: 'X' }])`)).toEqual([]);
    expect(read(`ClientsModule.register(options)`)).toEqual([]);
    expect(read(`ClientsModule.register([{ ...shared }])`)).toEqual([]);
    expect(read(`ClientsModule`)).toEqual([]);
  });
});
