import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { buildReactFunctionIndex } from './index-functions.js';

/** Indexes a repository written in memory, exactly as the reader would. */
const index = (files: Record<string, string>) => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, jsx: 4 },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  return buildReactFunctionIndex({ project, repo: 'web', repoDir: '/' });
};

const names = (files: Record<string, string>): string[] =>
  [...index(files).all()].map((fn) => `${fn.file}:${fn.name}`).sort();

describe('the functions a built export stands for', () => {
  // The reading this index and the route adapter share: an export whose value a
  // call built is a function under the exported name (R61, R72).
  it('gives a declaration marked export a node under its own name', () => {
    expect(
      names({
        '/src/api.ts': `
          import { wrap } from './wrap';
          export const load = wrap(async () => 1);
          const cached = wrap(async () => 2);
        `,
        '/src/wrap.ts': `export const wrap = (fn: unknown) => fn;`,
      }),
    ).toEqual(['src/api.ts:load', 'src/wrap.ts:wrap']);
  });

  // The condition that keeps every configured client and every memoised value
  // in a repository out of the index. It is now the module's export table that
  // answers it rather than an `export` keyword on the declaration, and this is
  // the case that must read the same either way.
  it('leaves a built value nobody exports out of the index', () => {
    expect(
      names({
        '/src/client.ts': `
          import { createClient } from './sdk';
          const client = createClient({ url: '' });
          export const send = async () => client.post();
        `,
        '/src/sdk.ts': `export const createClient = (options: unknown) => ({ post: async () => 1 });`,
      }),
    ).toEqual(['src/client.ts:send', 'src/sdk.ts:createClient']);
  });

  // `const handler = NextAuth(opts); export { handler as GET, handler as POST }`
  // is one function exported twice, and the node it gets carries the name it
  // was declared with — which is the name the route adapter computes for the
  // same declaration, so the two cannot disagree (R74).
  it('gives a local re-exported under other names one node, named as declared', () => {
    expect(
      names({
        '/src/route.ts': `
          import { wrap } from './wrap';
          const handler = wrap(async () => 1);
          export { handler as GET, handler as POST };
        `,
        '/src/wrap.ts': `export const wrap = (fn: unknown) => fn;`,
      }),
    ).toEqual(['src/route.ts:handler', 'src/wrap.ts:wrap']);
  });

  // `export const { POST } = serve(…)`: the name is a binding element, so the
  // declaration around it names nothing and used to be indexed under the text
  // of the pattern — a node called `{ POST }`, which no caller and no adapter
  // could ever ask for.
  it('gives a verb taken out of a built value a node under that name', () => {
    expect(
      names({
        '/src/route.ts': `
          import { serve } from './serve';
          export const { POST } = serve(async () => 1);
        `,
        '/src/serve.ts': `export const serve = (fn: unknown) => ({ POST: fn });`,
      }),
    ).toEqual(['src/route.ts:POST', 'src/serve.ts:serve']);
  });

  // A module that hands on somebody else's export says nothing about a function
  // of its own, and indexing one here would put a second node beside the one
  // the file that declares it already has.
  it('does not index a declaration another module owns', () => {
    expect(
      names({
        '/src/route.ts': `export { POST } from './handlers';`,
        '/src/handlers.ts': `
          import { serve } from './serve';
          export const POST = serve(async () => 1);
        `,
        '/src/serve.ts': `export const serve = (fn: unknown) => fn;`,
      }),
    ).toEqual(['src/handlers.ts:POST', 'src/serve.ts:serve']);
  });
});
