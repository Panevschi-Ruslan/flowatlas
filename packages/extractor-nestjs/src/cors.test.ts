import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readBootstrap } from './bootstrap.js';

const ROOT = '/repo';

const corsOf = (main: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(`${ROOT}/src/main.ts`, main);
  return readBootstrap({ project, rootDir: ROOT, absolutePath: `${ROOT}/src/main.ts`, relativePath: 'src/main.ts' }).cors;
};

/** What a browser on another origin is allowed (P388), as the `cors` middleware Nest hands the options to reads them. */
describe('the CORS settings a Nest application enables', () => {
  it('reads enableCors with no options as the defaults: any origin by *, no credentials', () => {
    expect(corsOf('async function b() { const app = await NestFactory.create(M); app.enableCors(); }')).toEqual({ at: 'src/main.ts:1', origin: '*', credentials: false });
  });

  it('reads the origins, credentials, headers and verbs written out', () => {
    expect(
      corsOf(`async function b() {
        const app = await NestFactory.create(M);
        app.enableCors({ origin: ['https://shop.test'], credentials: true, allowedHeaders: 'Authorization, Content-Type', methods: ['get', 'post'] });
      }`),
    ).toEqual({ at: 'src/main.ts:3', origin: 'list', credentials: true, allowedHeaders: ['authorization', 'content-type'], methods: ['GET', 'POST'] });
  });

  it('reads the cors option of NestFactory.create and the middleware used directly; what is not written out is unread', () => {
    expect(corsOf("async function b() { await NestFactory.create(M, { cors: { origin: true, credentials: true } }); }")).toMatchObject({ origin: 'reflect', credentials: true });
    expect(corsOf('async function b() { const app = await NestFactory.create(M); app.use(cors({ origin: allowed() })); }')).toMatchObject({ origin: 'unread', credentials: false });
    expect(corsOf('async function b() { const app = await NestFactory.create(M); app.enableCors(settings); }')).toMatchObject({ origin: 'unread', credentials: 'unread' });
    expect(corsOf('async function b() { await NestFactory.create(M); }')).toBeUndefined();
  });
});
