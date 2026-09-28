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
  it('does not count a call shown in a doc comment (cal.com getMetadataHelpers.ts)', () => {
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

  it('does not count one a route file imports (cal.com tasker/api/cron.ts)', () => {
    assert.deepEqual(sitesIn('packages/features/tasker/api/cron.ts', handler), {});
    assert.deepEqual(sitesIn('templates/ecommerce/src/app/(app)/next/exit-preview/GET.ts', handler), {});
    assert.deepEqual(sitesIn('src/router.ts', handler), {});
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
