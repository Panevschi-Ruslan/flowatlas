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
