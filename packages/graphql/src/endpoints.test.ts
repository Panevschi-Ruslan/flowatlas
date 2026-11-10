import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { fetchedQuery, graphqlCallOf, handedThrough } from './calls.js';
import { callAddressOf, clientAddressOf, pageClientIn } from './clients.js';
import { documentOf } from './documents.js';
import { serves } from './endpoints.js';
import { readGraphqlServer } from './servers.js';

const project = (files: Record<string, string>): Project => {
  const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true, jsx: 4 } });
  for (const [path, text] of Object.entries(files)) made.createSourceFile(path, text);
  return made;
};

const read = (made: Project) => readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@nestjs/graphql']) });

/** Which endpoints serve each field, as `Type.field: /path, /path`. */
const servedBy = (made: Project): Record<string, string[]> => {
  const reading = read(made);
  return Object.fromEntries(reading.fields.map((field) => [`${field.type}.${field.field}`, reading.endpoints.filter((each) => serves(each, field.resolver, field.tags ?? [])).map((each) => each.path)]));
};

const SCOPED = [
  "import { applyDecorators, SetMetadata } from '@nestjs/common';",
  "import { Resolver } from '@nestjs/graphql';",
  "export const StoreResolver = (of?) => applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata('SCOPE', 'store' as Scope));",
  "export const SettingsResolver = (of?) => applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata('SCOPE', 'settings'));",
].join('\n');

describe('the endpoints a NestJS server serves (P266)', () => {
  it('reads each GraphQLModule, its path from an enum, a factory and a class, and keeps the same field of two schemas apart by the tag', () => {
    const made = project({
      'paths.ts': "export enum ApiPath { Store = 'graphql', Settings = 'settings' }",
      'scoped.ts': SCOPED,
      'config.ts': [
        "import { ApiPath } from './paths';",
        'export class StoreConfig {',
        "  createGqlOptions() { return { autoSchemaFile: true, scope: 'store', path: `/${ApiPath.Store}` }; }",
        '}',
      ].join('\n'),
      'settings.factory.ts': [
        "import { ApiPath } from './paths';",
        "export const settingsFactory = async () => { const config = { scope: 'settings', path: `/${ApiPath.Settings}` }; return config; };",
      ].join('\n'),
      'app.module.ts': [
        "import { Module } from '@nestjs/common';",
        "import { GraphQLModule } from '@nestjs/graphql';",
        "import { StoreConfig } from './config';",
        "import { settingsFactory } from './settings.factory';",
        '@Module({ imports: [GraphQLModule.forRootAsync({ useClass: StoreConfig }), GraphQLModule.forRootAsync({ useFactory: settingsFactory })] })',
        'export class AppModule {}',
      ].join('\n'),
      'store.resolver.ts': [
        "import { Query } from '@nestjs/graphql';",
        "import { StoreResolver } from './scoped';",
        '@StoreResolver()',
        'export class StoreFront { @Query(() => String) me() { return ""; } }',
      ].join('\n'),
      'settings.resolver.ts': [
        "import { Mutation, Query } from '@nestjs/graphql';",
        "import { SettingsResolver } from './scoped';",
        '@SettingsResolver()',
        'export class Settings { @Query(() => String) me() { return ""; } @Mutation(() => String) rename() { return ""; } }',
      ].join('\n'),
    });
    const reading = read(made);
    expect(reading.endpoints.map((each) => [each.path, each.scope, each.unread])).toEqual([
      ['/graphql', 'store', []],
      ['/settings', 'settings', []],
    ]);
    const fields = reading.fields.map((field) => `${field.type}.${field.field} ${reading.endpoints.filter((each) => serves(each, field.resolver, field.tags ?? [])).map((each) => each.path).join(',')}`).sort();
    expect(fields).toEqual(['Mutation.rename /settings', 'Query.me /graphql', 'Query.me /settings']);
  });

  it('serves the resolvers of the modules include names, with what they import, where no scope is named', () => {
    const made = project({
      'app.module.ts': [
        "import { Module } from '@nestjs/common';",
        "import { GraphQLModule, Query, Resolver } from '@nestjs/graphql';",
        '@Resolver() export class Stores { @Query(() => String) stores() { return ""; } }',
        '@Resolver() export class Carts { @Query(() => String) carts() { return ""; } }',
        '@Module({ providers: [Stores] }) export class StoresModule {}',
        '@Module({ imports: [StoresModule] }) export class AdminModule {}',
        '@Module({ providers: [{ provide: Carts, useClass: Carts }] }) export class CartsModule {}',
        "@Module({ imports: [GraphQLModule.forRoot({ path: '/admin', include: [AdminModule] }), GraphQLModule.forRoot({ include: [CartsModule] })] })",
        'export class AppModule {}',
      ].join('\n'),
    });
    expect(servedBy(made)).toEqual({ 'Query.stores': ['/admin'], 'Query.carts': ['/graphql'] });
  });

  it('reads a module a function makes once per call, its options from what each call hands through the functions they pass (P281)', () => {
    const made = project({
      'settings.ts': [
        'export interface ApiSettings {',
        "  /** @description The public API's path.\n   * @default 'store-api'\n   */",
        '  storePath?: string;',
        "  /** @default 'back-office'\n   */",
        '  officePath?: string;',
        '}',
        'export class Settings { get api(): Required<ApiSettings> { return {} as any; } }',
      ].join('\n'),
      'configure.ts': [
        "import { GraphQLModule } from '@nestjs/graphql';",
        "import { Settings } from './settings';",
        'export interface ApiOptions { apiPath: string; resolverModule: Function }',
        'export function configureApi(getOptions: (settings: Settings) => ApiOptions) {',
        '  return GraphQLModule.forRootAsync({',
        '    useFactory: (settings: Settings) => createOptions(settings, getOptions(settings)),',
        '    inject: [Settings],',
        '  });',
        '}',
        'async function createOptions(settings: Settings, options: ApiOptions) {',
        '  const helper = () => ({ path: "/never" });',
        "  return { path: '/' + options.apiPath, include: [options.resolverModule], typeDefs: '' };",
        '}',
      ].join('\n'),
      'app.module.ts': [
        "import { Module } from '@nestjs/common';",
        "import { Query, Resolver } from '@nestjs/graphql';",
        "import { configureApi } from './configure';",
        '@Resolver() export class Catalog { @Query(() => String) products() { return ""; } }',
        '@Resolver() export class Staff { @Query(() => String) staff() { return ""; } }',
        '@Module({ providers: [Catalog] }) export class StoreApiModule {}',
        '@Module({ providers: [Staff] }) export class OfficeApiModule {}',
        '@Module({ imports: [',
        '  configureApi((settings) => ({ apiPath: settings.api.storePath, resolverModule: StoreApiModule })),',
        "  configureApi(() => ({ apiPath: 'office', resolverModule: OfficeApiModule })),",
        '] })',
        'export class AppModule {}',
      ].join('\n'),
    });
    const endpoints = read(made).endpoints;
    expect(endpoints.map((each) => [each.path, each.unread, each.defaulted?.length ?? 0])).toEqual([
      ['/store-api', [], 1],
      ['/office', [], 0],
    ]);
    expect(endpoints[0]?.defaulted?.[0]).toContain("the default its declaration documents");
    expect(servedBy(made)).toEqual({ 'Query.products': ['/store-api'], 'Query.staff': ['/office'] });
  });

  it('says a path written as code, and keeps the library default', () => {
    const made = project({
      'app.module.ts': [
        "import { GraphQLModule, Query, Resolver } from '@nestjs/graphql';",
        '@Resolver() export class Stores { @Query(() => String) stores() { return ""; } }',
        'const where = () => process.argv[2];',
        '@Module({ imports: [GraphQLModule.forRoot({ path: where() })] }) export class AppModule {}',
      ].join('\n'),
    });
    const [endpoint] = read(made).endpoints;
    expect(endpoint?.path).toBe('/graphql');
    expect(endpoint?.unread[0]).toContain('is not a string this could read');
  });

  it('says a schema a plugin of the repository answers past, and not one a cache does', () => {
    const made = project({
      'app.module.ts': [
        "import { GraphQLModule } from '@nestjs/graphql';",
        'const useRecords = () => ({ onRequest: async ({ endResponse }) => endResponse(new Response()) });',
        'const useCache = () => ({ onRequest: async ({ endResponse }) => endResponse(new Response()), onResponse: async () => undefined });',
        "@Module({ imports: [GraphQLModule.forRoot({ path: '/graphql', plugins: [useRecords()] }), GraphQLModule.forRoot({ path: '/settings', plugins: [useCache()] })] }) export class AppModule {}",
      ].join('\n'),
    });
    expect(read(made).endpoints.map((each) => [each.path, each.open])).toEqual([
      ['/graphql', 'its plugin useRecords answers requests itself'],
      ['/settings', undefined],
    ]);
  });
});

describe('the client an operation is sent with (P266)', () => {
  const FILES = {
    'factory.ts': [
      "import { ApolloClient, InMemoryCache } from '@apollo/client';",
      "import { useMemo } from 'react';",
      'export const useFactory = (options = {}) => useMemo(() => new ApolloClient({ uri: `${BASE}/graphql`, cache: new InMemoryCache(), ...options }), []);',
    ].join('\n'),
    'provider.tsx': [
      "import { ApolloProvider } from '@apollo/client';",
      "import { createContext, useContext } from 'react';",
      "import { useFactory } from './factory';",
      'export const Page = ({ children }) => { const client = useFactory({ uri: `${BASE}/settings` }); return <ApolloProvider client={client}>{children}</ApolloProvider>; };',
      'export const StoreContext = createContext(null);',
      'export const Store = ({ children }) => { const store = useFactory(); return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>; };',
      'export const useStore = () => useContext(StoreContext);',
    ].join('\n'),
    'admin.ts': [
      "import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';",
      "export const admin = new ApolloClient({ link: new HttpLink({ uri: '/admin' }), cache: new InMemoryCache() });",
    ].join('\n'),
    'screens.tsx': [
      "import { gql, useMutation, useQuery } from '@apollo/client';",
      "import { admin } from './admin';",
      "import { useStore } from './provider';",
      'const Q = gql`query Q { me { id } }`;',
      'export const Settings = () => useQuery(Q);',
      'export const Cart = () => { const client = useStore(); return useMutation(Q, { client }); };',
      'export const Stores = () => useQuery(Q, { client: admin });',
      'export const Handed = ({ given }) => useQuery(Q, { client: given });',
    ].join('\n'),
  };

  const addressAt = (made: Project, index: number): string => {
    const calls = made.getSourceFileOrThrow('screens.tsx').getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => /^use(Query|Mutation)$/.test(call.getExpression().getText()));
    const found = graphqlCallOf(calls[index] as CallExpression);
    if (found === undefined) throw new Error('no operation');
    const chosen = callAddressOf(found, made.getSourceFiles(), () => pageClientIn(made.getSourceFiles()));
    return chosen.kind === 'unread' ? `unread: ${chosen.why}` : (chosen.node?.getText() ?? 'none');
  };

  it('sends a call with no client of its own with the page provider\'s, and one that names a client with that one', () => {
    const made = project(FILES);
    expect(addressAt(made, 0)).toBe('`${BASE}/settings`');
    // Through a hook answering a context, to the value its provider hands down, to the factory's own default.
    expect(addressAt(made, 1)).toBe('`${BASE}/graphql`');
    expect(addressAt(made, 2)).toBe("'/admin'");
    expect(addressAt(made, 3)).toBe('unread: given is not bound to a client made in the repository');
  });

  it('reads Apollo useApolloClient() as the page client', () => {
    const made = project({
      'a.ts': "import { useApolloClient } from '@apollo/client';\nconst client = useApolloClient();\nexport const x = client;",
    });
    const value = made.getSourceFileOrThrow('a.ts').getVariableDeclarationOrThrow('x').getInitializerOrThrow();
    expect(clientAddressOf(value, made.getSourceFiles()).kind).toBe('default');
  });
});

describe('a document a helper is handed (P266)', () => {
  it('reads the document a caller hands the helper that posts it, a value in one of its strings left out', () => {
    const made = project({
      'seed.ts': [
        'const NAME = "shop";',
        'const post = (endpoint: string, query: string) => fetch(endpoint, { method: "POST", body: JSON.stringify({ query }) });',
        'post("/settings", `mutation Seed { rename(name: "${NAME}") { name } }`);',
      ].join('\n'),
    });
    const calls = made.getSourceFileOrThrow('seed.ts').getDescendantsOfKind(SyntaxKind.CallExpression);
    const network = calls.find((call) => call.getExpression().getText() === 'fetch') as CallExpression;
    const caller = calls.find((call) => call.getExpression().getText() === 'post') as CallExpression;
    const handed = handedThrough(fetchedQuery(network) as never, [caller]);
    const reading = documentOf(handed);
    expect(reading.kind).toBe('read');
    if (reading.kind !== 'read') return;
    expect(reading.document.definitions.map((definition) => definition.kind)).toEqual(['operation']);
  });

  it('still says a document whose shape is built from a hole outside a string', () => {
    const made = project({ 'a.ts': 'const F = "id";\nexport const q = `query Q { me { ${F} } }`;' });
    const value = made.getSourceFileOrThrow('a.ts').getVariableDeclarationOrThrow('q').getInitializerOrThrow();
    expect(documentOf(value).kind).toBe('dynamic');
  });
});
