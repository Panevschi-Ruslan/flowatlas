import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { expressRoutesAdapter } from './call-routes.js';

/**
 * The row a route answered by nothing nameable leaves behind, asserted by content.
 *
 * `route-handler-anonymous` fires on real repositories - four times on one of
 * them - and the only test that named it asserted that it was absent, so what
 * the row says was held to nothing. Kept in a file of its own rather than in
 * `call-routes.test.ts`, because the reader is being changed elsewhere and the
 * point of this case is to outlive that.
 */
const EXPRESS = `
export interface Request { params: any; body: any }
export interface Response { send(body?: unknown): Response; json(body: unknown): Response }
export type RequestHandler = (req: Request, res: Response, next: () => void) => unknown;
export interface Express {
  get(path: string, ...handlers: RequestHandler[]): this;
  post(path: string, ...handlers: RequestHandler[]): this;
}
declare function express(): Express;
export default express;
`;

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const read = (main: string, files: Record<string, string> = {}): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/node_modules/express/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/express/index.d.ts', EXPRESS);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  project.createSourceFile('/src/main.ts', main);
  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'express' },
    config: parseConfig({}),
    pkg: { dependencies: { express: '^4.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return { entries: expressRoutesAdapter.extractEntries(ctx), unresolved: ctx.builder.build().unresolved };
};

const anonymous = (rows: Unresolved[]): Unresolved[] =>
  rows.filter((row) => row.reason === 'route-handler-anonymous');

const PASSPORT = {
  '/node_modules/passport/package.json': '{"types":"index.d.ts"}',
  '/node_modules/passport/index.d.ts': `
import type { RequestHandler } from 'express';
declare const passport: { authenticate(strategy: string): RequestHandler };
export default passport;
`,
};

describe('routes answered by nothing the reader can point at', () => {
  it('counts them in one informational row, placed at the first of them', () => {
    const { entries, unresolved } = read(
      `
      import express from 'express';
      import passport from 'passport';
      const app = express();
      app.get('/health', (req, res) => res.send('ok'));
      app.get('/named', named);
      app.get('/login', passport.authenticate('google'));
      app.get('/login/callback', passport.authenticate('google'));
      function named(req, res) { res.send('named'); }
    `,
      PASSPORT,
    );

    // Every one of them is still a way in; only the edge to what answers it is missing.
    expect(entries.map((entry) => entry.id).sort()).toEqual([
      'entry:api:http:GET:/health',
      'entry:api:http:GET:/login',
      'entry:api:http:GET:/login/callback',
      'entry:api:http:GET:/named',
    ]);
    expect(anonymous(unresolved)).toEqual([
      {
        adapter: 'express-routes',
        file: 'src/main.ts',
        line: 7,
        reason: 'route-handler-anonymous',
        level: 'info',
        sites: 2,
        symbol: 'express',
        message:
          '2 routes answer with a function written in the declaration, so nothing can be pointed at as the code behind them.',
        hint:
          'Give the handler a name and register that, or have the one written in place return what a single named function answers with.',
      },
    ]);
  });

  it('says nothing when every handler is named or written in place', () => {
    const { unresolved } = read(`
      import express from 'express';
      const app = express();
      app.get('/health', (req, res) => res.send('ok'));
      app.get('/wrapped', ((req, res) => res.send('ok')));
      app.get('/named', named);
      function named(req, res) { res.send('named'); }
    `);
    expect(anonymous(unresolved)).toEqual([]);
  });
});
