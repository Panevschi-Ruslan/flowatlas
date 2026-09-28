import { describe, expect, it } from 'vitest';
import { isTestDirectory, isTestFile } from './test-files.js';

describe('isTestFile', () => {
  it.each([
    'orders.test.ts',
    'orders.spec.tsx',
    'app.e2e-spec.ts',
    'packages/features/credentials/handleDeleteCredential.integration-test.ts',
    'booking.unit-test.ts',
    'orders.test.helpers.ts',
    'playwright/login.e2e.ts',
    'packages/framework/src/resources/workflow/workflow.resource.test-d.ts',
    'src/orders.spec-helper.ts',
    'C:\\repo\\src\\orders.spec.ts',
  ])('reads %s as a test by its name', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    'apps/web/playwright/fixtures/users.ts',
    'src/__tests__/helpers.ts',
    'test/utils.ts',
    'src/e2e/helpers.ts',
    'src/orders/__mocks__/orders.store.ts',
  ])('reads %s as a test by a directory it is in', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    'test-utils.ts',
    'src/latest.ts',
    'src/inspect.ts',
    'src/e2e-kit.ts',
    'src/spec/orders.ts',
    'src/contest.entry.ts',
    'src/testing/index.ts',
  ])('reads %s as source: only a whole part of a name, or a whole directory name, counts', (path) => {
    expect(isTestFile(path)).toBe(false);
  });

  it('asks nothing of a path above the tree being read', () => {
    // The caller hands a path relative to what it reads; a package named `e2e`
    // read from its own directory is `src/index.ts`, and is source.
    expect(isTestFile('src/index.ts')).toBe(false);
    expect(isTestDirectory('e2e')).toBe(true);
  });
});
