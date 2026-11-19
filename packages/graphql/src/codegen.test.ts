import { Project, SyntaxKind, type CompilerOptions } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { documentOf, type DocumentReading } from './documents.js';
import { untaggedScopeIn } from './endpoints.js';
import { operationsOf } from './operations.js';

/** A project of these files, every one on its file system; TypeScript sources also as sources. */
const project = (files: Record<string, string>, compilerOptions: CompilerOptions = {}): Project => {
  const made = new Project({ useInMemoryFileSystem: true, compilerOptions });
  for (const [path, text] of Object.entries(files)) {
    if (/\.tsx?$/.test(path)) made.createSourceFile(path, text);
    else made.getFileSystem().writeFileSync(path, text);
  }
  return made;
};

/** What the first argument of the first `send(...)` in a file is read as. */
const readIn = (made: Project, file: string): DocumentReading => {
  const call = made.getSourceFileOrThrow(file).getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send');
  return documentOf(call?.getArguments()[0]);
};

const fieldsOf = (reading: DocumentReading): string[] => {
  if (reading.kind !== 'read') throw new Error(`not read: ${reading.why}`);
  const [operation] = operationsOf(reading.document, reading.fragments);
  const names = (fields: readonly { field: string; selections: readonly unknown[] }[]): string[] =>
    fields.flatMap((field) => [field.field, ...names(field.selections as never)]);
  return [`${operation?.operation} ${operation?.name}`, ...names(operation?.fields ?? [])];
};

describe('a codegen document the repository does not commit (P275)', () => {
  it('is the operation of that name in the documents the configuration its scripts name lists, its fragments from other files', () => {
    const made = project({
      '/web/package.json': JSON.stringify({ scripts: { codegen: 'graphql-codegen --config gql-codegen.yml' } }),
      '/web/gql-codegen.yml': "generates:\n  src/backend/graphql.ts:\n    documents: 'src/**/*.graphql'\n    plugins:\n      - typed-document-node\n",
      '/web/src/gql/Orders.graphql': 'query Orders { orders { ...OrderFields } }',
      '/web/src/gql/fields.graphql': 'fragment OrderFields on Order { id total }',
      '/web/src/page.ts': "import { OrdersDocument } from './backend/graphql';\nsend(OrdersDocument);",
    });
    expect(fieldsOf(readIn(made, '/web/src/page.ts'))).toEqual(['query Orders', 'orders', 'id', 'total']);
  });

  it('names a document in PascalCase, with or without its type after it, through the project paths', () => {
    const made = project(
      {
        '/admin/package.json': '{}',
        '/admin/codegen.ts': "export default { documents: ['src/**/*.graphql'], generates: { 'src/generated/': { preset: 'client' } } };",
        '/admin/src/ToggleSMTP.graphql': 'mutation ToggleSMTP { toggleSMTP { enabled } }',
        '/admin/src/Stock.graphql': 'query Stock { stock { count } }',
        '/admin/src/page.ts': "import { ToggleSmtpDocument, StockQueryDocument } from '~/generated';\nsend(ToggleSmtpDocument);\nexport const other = () => send(StockQueryDocument);",
      },
      { baseUrl: '/admin', paths: { '~/*': ['src/*'] } },
    );
    expect(fieldsOf(readIn(made, '/admin/src/page.ts'))).toEqual(['mutation ToggleSMTP', 'toggleSMTP', 'enabled']);
    const calls = made.getSourceFileOrThrow('/admin/src/page.ts').getDescendantsOfKind(SyntaxKind.CallExpression);
    expect(fieldsOf(documentOf(calls[1]?.getArguments()[0]))).toEqual(['query Stock', 'stock', 'count']);
  });

  it('reads every .graphql file of the package where no configuration is found, and says a name none holds', () => {
    const made = project({
      '/shop/package.json': '{}',
      '/shop/src/Cart.graphql': 'query Cart { cart { id } }',
      '/shop/src/page.ts': "import { CartDocument, CheckoutDocument } from './gql/graphql';\nsend(CartDocument);\nexport const later = () => send(CheckoutDocument);",
    });
    expect(fieldsOf(readIn(made, '/shop/src/page.ts'))).toEqual(['query Cart', 'cart', 'id']);
    const calls = made.getSourceFileOrThrow('/shop/src/page.ts').getDescendantsOfKind(SyntaxKind.CallExpression);
    const missing = documentOf(calls[1]?.getArguments()[0]);
    expect(missing.kind).toBe('dynamic');
    if (missing.kind === 'dynamic') expect(missing.why).toContain('no operation named Checkout');
  });

  it('reads nothing of a missing module that is not named like a codegen output', () => {
    const made = project({
      '/shop/package.json': '{}',
      '/shop/src/Cart.graphql': 'query Cart { cart { id } }',
      '/shop/src/page.ts': "import { CartDocument } from './documents-store';\nsend(CartDocument);",
    });
    expect(readIn(made, '/shop/src/page.ts').kind).toBe('dynamic');
  });
});

describe('the scope a patched library gives a resolver with none (P275)', () => {
  const patch = (line: string): { path: string; text: string } => ({
    path: 'patches/lib.patch',
    text: ['--- a/dist/explorer.js', '+++ b/dist/explorer.js', "+const SCOPE_KEY = 'SCHEMA_SCOPE';", ' let explorer = class {', `+        ${line}`].join('\n'),
  });

  it('is read from a line the patch adds, the key a constant it declares', () => {
    const found = untaggedScopeIn([patch("const scope = Reflect.getMetadata(SCOPE_KEY, wrapper.metatype) || 'settings';")], new Set(['SCHEMA_SCOPE']), new Set(['store', 'settings']));
    expect(found).toEqual({ scope: 'settings', from: 'patches/lib.patch' });
  });

  it('is nothing where the key is not the one the resolvers are tagged under, or the scope is not a tag', () => {
    expect(untaggedScopeIn([patch("Reflect.getMetadata(SCOPE_KEY, target) || 'settings'")], new Set(['OTHER']), new Set(['settings']))).toBeUndefined();
    expect(untaggedScopeIn([patch("Reflect.getMetadata('SCHEMA_SCOPE', target) ?? 'reports'")], new Set(['SCHEMA_SCOPE']), new Set(['settings']))).toBeUndefined();
  });

  it('is nothing where two patches disagree, and a context line is not read as added', () => {
    const one = patch("Reflect.getMetadata(SCOPE_KEY, target) || 'settings'");
    const two = { path: 'patches/other.patch', text: "+Reflect.getMetadata('SCHEMA_SCOPE', target) || 'store'" };
    expect(untaggedScopeIn([one, two], new Set(['SCHEMA_SCOPE']), new Set(['store', 'settings']))).toBeUndefined();
    const context = { path: 'p', text: " Reflect.getMetadata('SCHEMA_SCOPE', target) || 'store'" };
    expect(untaggedScopeIn([context], new Set(['SCHEMA_SCOPE']), new Set(['store']))).toBeUndefined();
  });
});
