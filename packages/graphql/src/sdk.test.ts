import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { graphqlCallOf, type GraphqlCall } from './calls.js';
import { callAddressOf } from './clients.js';
import { documentOf, type DocumentReading } from './documents.js';
import { operationsOf } from './operations.js';

/** A project of these files, every one on its file system, as a clone has them; TypeScript sources also as sources. */
const project = (files: Record<string, string>): Project => {
  const made = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) {
    made.getFileSystem().writeFileSync(path, text);
    if (/\.tsx?$/.test(path)) made.addSourceFileAtPath(path);
  }
  return made;
};

/** Every call of a file whose callee ends in `.<method>`. */
const callOf = (made: Project, file: string, method: string): CallExpression => {
  const found = made
    .getSourceFileOrThrow(file)
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText().endsWith(`.${method}`));
  if (found === undefined) throw new Error(`no call of ${method}`);
  return found;
};

const operationOf = (found: GraphqlCall | undefined): string => {
  const reading: DocumentReading = found?.reading ?? documentOf(found?.document);
  if (reading.kind !== 'read') return `unread: ${reading.why}`;
  const [operation] = operationsOf(reading.document, reading.fragments);
  return `${operation?.operation} ${operation?.fields.map((field) => field.field).join(',')}`;
};

const addressOf = (found: GraphqlCall): string => {
  const chosen = callAddressOf(found, [], () => undefined);
  return chosen.kind === 'address' ? (chosen.node?.getText() ?? '') : `unread: ${chosen.why}`;
};

/** A generated module as the generic SDK plugin writes it. */
const GENERATED = `
import gql from 'graphql-tag';
export const SignInDocument = gql\`mutation signIn($email: String!) { signIn(email: $email) { id } }\`;
export const CartDocument = gql\`query cart { cart { id lines { id } } }\`;
export type Requester<C = {}> = <R, V>(doc: unknown, vars?: V, options?: C) => Promise<R>;
export function getSdk<C>(requester: Requester<C>) {
  return {
    signIn(variables: { email: string }, options?: C): Promise<unknown> {
      return requester(SignInDocument, variables, options) as Promise<unknown>;
    },
    cart(variables?: {}, options?: C): Promise<unknown> {
      return requester(CartDocument, variables, options) as Promise<unknown>;
    },
  };
}
`;

describe('a call through an SDK GraphQL codegen writes (P281)', () => {
  it('is the operation the method sends, sent where the requester handed to getSdk posts', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': GENERATED,
      '/shop/src/constants.ts': 'export const API_URL = process.env.SHOP_API_URL;',
      '/shop/src/client.ts': `
        import { getSdk } from './generated/graphql';
        import { API_URL } from './constants';
        async function post(body: { query: string; variables?: unknown }) {
          return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());
        }
        function requester(doc: unknown, variables?: unknown) {
          return post({ query: String(doc), variables });
        }
        const base = getSdk(requester);
        export const sdk = base as any;
      `,
      '/shop/src/account.ts': `
        import { sdk } from './client';
        export const signIn = (email: string) => sdk.signIn({ email });
        export const cart = () => sdk
          .cart({});
      `,
    });
    const signIn = graphqlCallOf(callOf(made, '/shop/src/account.ts', 'signIn'));
    expect(signIn?.library).toBe('codegen-sdk');
    expect(operationOf(signIn)).toBe('mutation signIn');
    expect(addressOf(signIn as GraphqlCall)).toBe('API_URL');
    expect(operationOf(graphqlCallOf(callOf(made, '/shop/src/account.ts', 'cart')))).toBe('query cart');
  });

  it('follows a function that answers the SDK and a GraphQLClient handed to it', () => {
    const made = project({
      '/web/src/generated/graphql.ts': GENERATED,
      '/web/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { getSdk } from './generated/graphql';
        const client = new GraphQLClient('http://localhost:4000/store-api');
        export const sdkFor = () => getSdk(client as any);
      `,
      '/web/src/page.ts': "import { sdkFor } from './client';\nexport const load = () => sdkFor().cart();",
    });
    const cart = graphqlCallOf(callOf(made, '/web/src/page.ts', 'cart'));
    expect(operationOf(cart)).toBe('query cart');
    expect(addressOf(cart as GraphqlCall)).toBe("'http://localhost:4000/store-api'");
  });

  it('reads the operation of the method name from the documents codegen lists, where the module is not committed', () => {
    const made = project({
      '/app/package.json': '{}',
      '/app/codegen.yml': "documents:\n  - 'src/**/*.ts'\ngenerates:\n  src/generated/graphql.ts:\n    plugins:\n      - typescript-generic-sdk\n",
      '/app/src/queries.ts': "import gql from 'graphql-tag';\nexport const Q = gql`query orderList { orders { id } }`;",
      '/app/src/client.ts': `
        import { getSdk } from './generated/graphql';
        const requester = (doc: unknown) => fetch('/graphql', { method: 'POST', body: JSON.stringify({ query: doc }) });
        export const sdk = getSdk(requester);
      `,
      '/app/src/page.ts': "import { sdk } from './client';\nexport const list = () => sdk.orderList();\nexport const gone = () => sdk.missing();",
    });
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'orderList')))).toBe('query orders');
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'missing')))).toContain('no operation named missing');
  });

  it('says a requester that sends nowhere it can read, or to two addresses', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': GENERATED,
      '/shop/src/client.ts': `
        import { getSdk } from './generated/graphql';
        declare const transport: (doc: unknown) => Promise<unknown>;
        export const quiet = getSdk(transport);
        const both = (doc: unknown) => (Math.random() > 0.5 ? fetch('/a', { body: '' }) : fetch('/b', { body: '' }));
        export const split = getSdk(both);
      `,
      '/shop/src/page.ts': "import { quiet, split } from './client';\nexport const a = () => quiet.cart();\nexport const b = () => split.cart();",
    });
    const calls = made.getSourceFileOrThrow('/shop/src/page.ts').getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getText().endsWith('.cart'));
    const [quiet, split] = calls.map((call) => graphqlCallOf(call) as GraphqlCall);
    expect(addressOf(quiet as GraphqlCall)).toContain('is not a function or a GraphQLClient');
    expect(addressOf(split as GraphqlCall)).toContain('sends to 2 addresses');
  });

  it('is nothing for a method of an object no getSdk made', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': GENERATED,
      '/shop/src/page.ts': "const store = { cart: () => 1 };\nexport const a = () => store.cart();",
    });
    expect(graphqlCallOf(callOf(made, '/shop/src/page.ts', 'cart'))).toBeUndefined();
  });
});

/** The generated module with its factory written under another name, and the SWR plugin's factory over it. */
const RENAMED = GENERATED.replace('export function getSdk<C>', 'export function makeStoreSdk<C>');
const WITH_HOOKS = `${GENERATED}
declare function useSWR(key: unknown, fetcher: () => unknown): unknown;
export function getSdkWithHooks(client: any) {
  const sdk = getSdk(client);
  return {
    ...sdk,
    useCart(key: string, variables?: {}) {
      return useSWR(key, () => sdk.cart(variables));
    },
  };
}
`;

describe('an SDK factory known by what its module exports (P285)', () => {
  it('reads a committed factory under any name by the methods it answers, and one re-exported under another name', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': RENAMED,
      '/shop/src/generated/index.ts': "export { makeStoreSdk as createApi } from './graphql';",
      '/shop/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { createApi } from './generated';
        export const api = createApi(new GraphQLClient('/store-api') as any);
      `,
      '/shop/src/page.ts': "import { api } from './client';\nexport const go = () => api.signIn({ email: 'a' });",
    });
    const signIn = graphqlCallOf(callOf(made, '/shop/src/page.ts', 'signIn'));
    expect(operationOf(signIn)).toBe('mutation signIn');
    expect(addressOf(signIn as GraphqlCall)).toBe("'/store-api'");
  });

  it('reads the SWR factory: a method of the SDK it spreads, and a hook sending that method', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': WITH_HOOKS,
      '/shop/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { getSdkWithHooks } from './generated/graphql';
        export const sdk = getSdkWithHooks(new GraphQLClient('/store-api'));
      `,
      '/shop/src/page.ts': "import { sdk } from './client';\nexport const a = () => sdk.signIn({ email: 'a' });\nexport const b = () => sdk.useCart('cart');",
    });
    expect(operationOf(graphqlCallOf(callOf(made, '/shop/src/page.ts', 'signIn')))).toBe('mutation signIn');
    const hook = graphqlCallOf(callOf(made, '/shop/src/page.ts', 'useCart'));
    expect(operationOf(hook)).toBe('query cart');
    expect(addressOf(hook as GraphqlCall)).toBe("'/store-api'");
    // The hook's own call of the SDK is sent at each call of the hook, not where it is written.
    expect(graphqlCallOf(callOf(made, '/shop/src/generated/graphql.ts', 'cart'))).toBeUndefined();
  });

  it('reads getSdkWithHooks and getSdk re-exported under another name from a module nobody committed', () => {
    const made = project({
      '/app/package.json': '{}',
      '/app/codegen.yml': "documents: 'src/**/*.graphql'\ngenerates:\n  src/generated/sdk.ts:\n    plugins:\n      - typescript-graphql-request\n      - plugin-typescript-swr\n",
      '/app/src/orders.graphql': 'query orderList { orders { id } }',
      '/app/src/api.ts': "export { getSdk as createOrdersApi } from './generated/sdk';",
      '/app/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { getSdkWithHooks } from './generated/sdk';
        import { createOrdersApi } from './api';
        const client = new GraphQLClient('/graphql');
        export const hooks = getSdkWithHooks(client);
        export const plain = createOrdersApi(client);
      `,
      '/app/src/page.ts': "import { hooks, plain } from './client';\nexport const a = () => hooks.useOrderList('k');\nexport const b = () => plain.orderList();",
    });
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'useOrderList')))).toBe('query orders');
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'orderList')))).toBe('query orders');
  });

  it('follows export * to the module nobody committed that the configuration generates (P293)', () => {
    const made = project({
      '/app/package.json': '{}',
      // Two outputs nobody committed, both generated: the one the SDK plugin writes holds the factory.
      '/app/codegen.yml': "documents: 'src/**/*.graphql'\ngenerates:\n  src/generated/scalars.ts:\n    plugins:\n      - typescript\n  src/generated/sdk.ts:\n    plugins:\n      - typescript-graphql-request\n",
      '/app/src/orders.graphql': 'query orderList { orders { id } }',
      '/app/src/generated/index.ts': "export * from './scalars';\nexport * from './sdk';",
      '/app/src/api/index.ts': "export * from '../generated';",
      '/app/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { getSdk } from './api';
        export const api = getSdk(new GraphQLClient('/graphql'));
      `,
      '/app/src/page.ts': "import { api } from './client';\nexport const a = () => api.orderList();",
    });
    const found = graphqlCallOf(callOf(made, '/app/src/page.ts', 'orderList'));
    expect(operationOf(found)).toBe('query orders');
    expect(addressOf(found as GraphqlCall)).toBe("'/graphql'");
  });

  it('reads the factory the add plugin writes out under another name, and the infinite hooks useSWRInfinite writes (P293)', () => {
    const made = project({
      '/app/package.json': '{}',
      '/app/codegen.yml': [
        "documents: 'src/**/*.graphql'",
        'generates:',
        '  src/generated/sdk.ts:',
        '    plugins:',
        '      - typescript-graphql-request',
        '      - plugin-typescript-swr',
        '      - add:',
        "          content: 'export { getSdkWithHooks as createStoreHooks }'",
        '    config:',
        "      useSWRInfinite: ['orderList']",
        '',
      ].join('\n'),
      '/app/src/orders.graphql': 'query orderList { orders { id } }',
      '/app/src/client.ts': `
        import { GraphQLClient } from 'graphql-request';
        import { createStoreHooks } from './generated/sdk';
        export const hooks = createStoreHooks(new GraphQLClient('/graphql'));
      `,
      '/app/src/page.ts': "import { hooks } from './client';\nexport const a = () => hooks.useOrderListInfinite('k');\nexport const b = () => hooks.useOrderList('k');",
    });
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'useOrderListInfinite')))).toBe('query orders');
    expect(operationOf(graphqlCallOf(callOf(made, '/app/src/page.ts', 'useOrderList')))).toBe('query orders');
  });

  it('is nothing for a function answering methods that send no document through what it is handed', () => {
    const made = project({
      '/shop/src/generated/graphql.ts': GENERATED,
      '/shop/src/store.ts': "export const makeStore = (client: { get(key: string): unknown }) => ({ cart: () => client.get('cart') });\nexport const store = makeStore(new Map() as any);",
      '/shop/src/page.ts': "import { store } from './store';\nexport const a = () => store.cart();",
    });
    expect(graphqlCallOf(callOf(made, '/shop/src/page.ts', 'cart'))).toBeUndefined();
  });
});
