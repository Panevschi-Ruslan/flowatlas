/**
 * The counting rule's own tests (R157).
 *
 * The rule is the denominator of every coverage figure and the other half of the
 * read gate, so where it is wrong the gate is wrong with it. Three things are
 * held here, each of them once wrong on a real repository: a probe reads code
 * and not comments, a verb exported from a file no router serves is not a way
 * in, and a test file is what the tool says it is.
 *
 *   node --test scripts/coverage/counting-rule.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTestFile } from '@flowatlas/core';
import { isSourceFile, measureSites, withoutComments } from './counting-rule.mjs';

/** The sites one file holds, by family. */
const sitesIn = (path, text) => measureSites([[path, text]]).perFile.get(path) ?? {};

describe('a probe reads code, not comments', () => {
  it('does not count a call shown in a doc comment (getMetadataHelpers.ts, from a scheduling app)', () => {
    const text = [
      '/**',
      ' * The caller writes:',
      ' * prisma.team.update({ ..., data: { metadata: newMetadata } });',
      ' */',
      'export const merge = (a, b) => ({ ...a, ...b });',
    ].join('\n');
    assert.deepEqual(sitesIn('packages/lib/getMetadataHelpers.ts', text), {});
  });

  it('does not count a line comment, and still counts the code before it', () => {
    const text = 'await prisma.user.findMany(); // prisma.order.count() too\n// knex("orders")\n';
    assert.deepEqual(sitesIn('src/a.ts', text), { data: 1 });
  });

  it('does not count a model commented out of a schema', () => {
    const text = 'model User {\n  id Int @id\n}\n// model Legacy {\n/// model Doc {\n';
    assert.deepEqual(sitesIn('prisma/schema.prisma', text), { models: 1 });
  });

  it('leaves a string that holds a comment opening a string, and the code after it code', () => {
    const text = "const url = 'http://example.com/*'; await prisma.user.count();\n";
    assert.deepEqual(sitesIn('src/a.ts', text), { data: 1 });
    const template = 'const u = `//${host}`; await prisma.user.count();\n';
    assert.deepEqual(sitesIn('src/b.ts', template), { data: 1 });
  });

  it('reads a regular expression as one, not as the start of a comment', () => {
    const text = 'const r = /\\/*/g; await prisma.user.count();\nconst half = a / b; // prisma.x.count()\n';
    assert.deepEqual(sitesIn('src/a.ts', text), { data: 1 });
  });

  it('keeps every line where it was', () => {
    const text = '/* one\ntwo */ x\n// three\ny';
    const blanked = withoutComments(text);
    assert.equal(blanked.split('\n').length, text.split('\n').length);
    assert.equal(blanked.length, text.length);
    assert.match(blanked, /^\s+x\n\s+\ny$/);
  });

  it('reads a template as markup, where `//` is part of an address', () => {
    const text = '<a href="//cdn.example.com">x</a>\n<button (click)="save()">Save</button>\n';
    assert.deepEqual(sitesIn('src/app.component.html', text), { clicks: 1 });
  });
});

describe('a verb exported where a router serves it', () => {
  const handler = 'export async function GET() {\n  return new Response("ok");\n}\n';

  it('counts one in a route file', () => {
    assert.deepEqual(sitesIn('apps/web/app/api/tasks/cron/route.ts', handler), { routes: 1 });
    assert.deepEqual(sitesIn('src/api/store/orders/route.js', handler), { routes: 1 });
    assert.deepEqual(sitesIn('src/routes/health/+server.ts', handler), { routes: 1 });
  });

  it('does not count one a route file imports (tasker/api/cron.ts, from a scheduling app)', () => {
    assert.deepEqual(sitesIn('packages/features/tasker/api/cron.ts', handler), {});
    assert.deepEqual(sitesIn('templates/ecommerce/src/app/(app)/next/exit-preview/GET.ts', handler), {});
    assert.deepEqual(sitesIn('src/router.ts', handler), {});
  });
});

describe('a function a CDK app makes (P57)', () => {
  it('counts one made with a scope and an id, however the class is imported', () => {
    const text = [
      "const a = new NodejsFunction(this, 'PlaceOrder', { entry });",
      "const b = new lambda.Function(scope, 'Sender', { handler: 'send.handler' });",
      "const c = new cdk.aws_lambda.DockerImageFunction(this, 'Renderer', {});",
    ].join('\n');
    assert.deepEqual(sitesIn('lib/orders-stack.ts', text), { routes: 3 });
  });

  it("does not count the language's own Function constructor", () => {
    assert.deepEqual(sitesIn('src/sandbox.ts', "const run = new Function('a', 'return a + 1');\n"), {});
  });
});

describe('a route a Nuxt module adds (P251)', () => {
  it('counts a handler handed a route, written on one line or across several', () => {
    const text = [
      "addServerHandler({ route: '/api/catalog', method: 'get', handler: resolver.resolve('./runtime/catalog') });",
      'addServerHandler({',
      "  handler: resolver.resolve('./runtime/audit'),",
      '  route: auditRoute,',
      '});',
    ].join('\n');
    assert.deepEqual(sitesIn('modules/catalog/index.ts', text), { routes: 2 });
  });

  it('does not count one that stands in front of every route', () => {
    assert.deepEqual(sitesIn('modules/audit.ts', "addServerHandler({ middleware: true, handler: resolve('./stamp') });\n"), {});
  });
});

describe('a function a SAM template declares (P246)', () => {
  it('counts each by its Type, a SAM function and a plain one alike, and not in a comment', () => {
    const text = [
      'Resources:',
      '  PlaceOrder:',
      '    Type: AWS::Serverless::Function',
      '  Legacy:',
      "    Type: 'AWS::Lambda::Function'",
      '  # Type: AWS::Serverless::Function',
      '  Queue:',
      '    Type: AWS::SQS::Queue',
    ].join('\n');
    assert.deepEqual(sitesIn('template.yaml', text), { routes: 2 });
    assert.equal(isSourceFile('services/orders/template.yml'), true);
  });

  it('reads every YAML file and a JSON one named as a template, and no probe of code looks in one (P248)', () => {
    assert.equal(isSourceFile('openapi.yaml'), true);
    assert.equal(isSourceFile('legacy/fleet.template'), true);
    assert.equal(isSourceFile('stacks/orders.template.json'), true);
    assert.equal(isSourceFile('package.json'), false);
    assert.equal(isSourceFile('.github/workflows/template.yaml.bak'), false);
    assert.deepEqual(sitesIn('docs.yaml', "example: app.get('/orders', handler)\nfetch: fetch('/orders')\n"), {});
  });
});

describe('a function a plain CloudFormation template declares (P248)', () => {
  it('counts each by its Type, in YAML under any name and in JSON named as a template', () => {
    const yaml = ['Resources:', '  Kiosk:', '    Type: AWS::Lambda::Function', '  Url:', '    Type: AWS::Lambda::Url'].join('\n');
    assert.deepEqual(sitesIn('stacks/rides.yaml', yaml), { routes: 1 });
    const json = JSON.stringify({ Resources: { A: { Type: 'AWS::Lambda::Function' }, B: { Type: 'AWS::Serverless::Function' } } }, null, 2);
    assert.deepEqual(sitesIn('stacks/rides.template.json', json), { routes: 2 });
    assert.deepEqual(sitesIn('legacy/fleet.template', json), { routes: 2 });
  });
});

describe('a test file, by the definition the tool reads by', () => {
  const tests = [
    'packages/features/credentials/handleDeleteCredential.integration-test.ts',
    'src/orders.test.ts',
    'src/orders.spec.tsx',
    'test/app.e2e-spec.ts',
    'apps/web/playwright/booking-seats.e2e.ts',
    'apps/web/playwright/fixtures/users.ts',
    'src/__tests__/seed.ts',
  ];

  it('is not source, exactly where the tool does not read it', () => {
    for (const path of tests) {
      assert.equal(isTestFile(path), true, path);
      assert.equal(isSourceFile(path), false, path);
    }
  });

  it('leaves a file whose name only contains the word source', () => {
    for (const path of ['src/test-utils.ts', 'src/latest.ts', 'packages/e2e-kit/src/index.ts']) {
      assert.equal(isTestFile(path), false, path);
      assert.equal(isSourceFile(path), true, path);
    }
  });
});

describe('a procedure of a tree (R95, P58)', () => {
  it('counts a chain ending in a function written in place', () => {
    const text = [
      'export const list = authed.input(OrderQuery).handler(async ({ input }) => find(input));',
      'export const read = procedure.query(({ ctx }) => ctx.user);',
      'export const save = procedure.mutation(async function save() { return 1; });',
    ].join('\n');
    assert.deepEqual(sitesIn('src/server/orders.ts', text), { routes: 3 });
  });

  it('does not count a database call that ends in the same word', () => {
    const text = "await pool.query('select 1');\nawait pool.query(sql, [id]);\nconst handler = route.handler;\n";
    assert.deepEqual(sitesIn('src/db.ts', text), {});
  });
});

describe('where a request is written, and what stands in front of it (P244)', () => {
  it('counts the platform client by its own name, a verb with its address written out, and a config call', () => {
    const text = [
      "await fetch('/api/orders');",
      "await $fetch('/api/items', { method: 'POST' });",
      "this.http.get<Order[]>('/orders');",
      'api.post(`${base}/orders`, body);',
      "axios.get('orders');",
      "api({ url: '/orders', method: 'post' });",
      "axios.request({\n  url: '/items',\n});",
    ].join('\n');
    assert.deepEqual(sitesIn('src/api.ts', text), { requests: 7 });
  });

  it('does not count a store looked up by a key, a method named fetch, or a call handed a path it was given', () => {
    const text = [
      "cache.get('orders');",
      'documents.get(id);',
      'store.fetch(id);',
      'this.http.get(path);',
      "useFetch('/api/orders');",
    ].join('\n');
    assert.deepEqual(sitesIn('src/a.ts', text), {});
  });

  it('counts an instance made with options of its own and each function run before every request', () => {
    const text = [
      "export const api = axios.create({ baseURL: '/api' });",
      "export const shop = $fetch.create({ onRequest({ options }) { options.baseURL = '/shop'; } });",
      'export const billing = ky.extend({ hooks: { beforeRequest: [(request) => request] } });',
      'api.interceptors.request.use((config) => config);',
      'export class BaseInterceptor implements HttpInterceptor {}',
      'export const base: HttpInterceptorFn = (req, next) => next(req);',
    ].join('\n');
    assert.deepEqual(sitesIn('src/api.ts', text), { bases: 8 });
  });

  it('counts each server started on a port, and not a listen with nothing to listen on', () => {
    const text = [
      'app.listen(3001);',
      'await app.listen({ port: Number(process.env.PORT) || 3002 });',
      'http.createServer(app).listen(port, () => {});',
      'serve({ fetch: app.fetch, port: 3003 });',
      'Bun.serve({ port: 3004, fetch });',
      'Deno.serve(handler);',
      'server.listen();',
      'observe(source, { serve: true });',
    ].join('\n');
    assert.deepEqual(sitesIn('src/main.ts', text), { listens: 6 });
  });

  it("counts a dev server's port in a bundler's configuration, and a port anywhere else in no such file (P254)", () => {
    const config = 'export default defineConfig({\n  server: { port: 5174, strictPort: true },\n  preview: { port: 4180 },\n});';
    assert.deepEqual(sitesIn('vite.config.ts', config), { listens: 2 });
    assert.deepEqual(sitesIn('astro.config.mjs', 'export default defineConfig({ server: { port: 4330 } });'), { listens: 1 });
    assert.deepEqual(sitesIn('src/settings.ts', 'export const config = { port: 3003 };'), {});
  });

  it("counts a server's proxy and rewrites, and a port a cluster manifest routes (P257)", () => {
    const vite = "export default defineConfig({\n  server: {\n    port: 5180,\n    proxy: { '/api': 'http://localhost:3001' },\n  },\n});";
    assert.deepEqual(sitesIn('vite.config.ts', vite), { listens: 2 });
    const next = "module.exports = {\n  async rewrites() {\n    return [{ source: '/api/:path*', destination: 'http://localhost:3001/:path*' }];\n  },\n};";
    assert.deepEqual(sitesIn('next.config.js', next), { listens: 1 });
    const nuxt = "export default defineNuxtConfig({\n  routeRules: { '/api/**': { proxy: 'http://localhost:3001/**' } },\n  nitro: { devProxy: { '/x': 'http://localhost:3002' } },\n});";
    assert.deepEqual(sitesIn('nuxt.config.ts', nuxt), { listens: 2 });
    const manifest = 'kind: Service\nspec:\n  ports:\n    - port: 80\n      targetPort: 3000\n    - targetPort: http\n      port: 81\n';
    assert.deepEqual(sitesIn('k8s/orders.yaml', manifest), { listens: 2 });
    assert.deepEqual(sitesIn('src/api.ts', "const proxy: Proxy = { target: 'x' };"), {});
  });
});
