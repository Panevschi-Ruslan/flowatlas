/**
 * What a test is, written once for the tool and for the coverage harness (R157).
 *
 * A test declares things that are never served: routes a test server stands up,
 * queries that seed rows and assert on them, components rendered once to be
 * looked at. None of that is the system, so **a test is not read**, and nothing
 * in it is counted either. Both halves have to hold for the same files, or the
 * counting rule expects nodes from a file the tool never opened, or the tool
 * reads a file the rule never counted and puts a test's set-up in the graph as
 * though the service did it.
 *
 * They used to be two lists. The tool skipped `.spec`, `.test` and `.e2e-spec`
 * before the extension and no directory at all; the counting rule skipped
 * `.test.` and `.spec.` anywhere in a name and a list of directories. Neither
 * matched cal.com's `*.integration-test.ts`, so the rule counted six files of
 * database set-up the tool read with no function to hang a query on, and the
 * read gate reported them as unread. The tool, for its part, read cal.com's
 * whole `playwright/` directory, which the rule had never counted.
 *
 * So one definition, in two parts, and nothing else decides:
 *
 * - **by name**: one dot-separated part of the file's name after the first is
 *   `test`, `spec` or `e2e`, alone or as a word of a hyphenated one.
 *   `orders.test.ts`, `orders.spec.ts`, `app.e2e-spec.ts`, `login.e2e.ts`,
 *   `booking.integration-test.ts`, `workflow.test-d.ts` and
 *   `orders.test.helpers.ts` are tests; `test-utils.ts`, `latest.ts` and
 *   `e2e-kit.ts` are not. The spelling is not one repository's - `.unit-test`,
 *   `.int-spec`, `.test-d` and `.api-e2e` are all in use - so the rule is the
 *   shape rather than another word.
 * - **by directory**: a directory whose name is only ever a test's. A test
 *   runner's own (`playwright`, `cypress`), the conventions of the runners that
 *   find tests by folder (`__tests__`, `__mocks__`, `__snapshots__`), and the
 *   folders a repository keeps its tests and their data in (`test`, `tests`,
 *   `e2e`, `fixtures`, `__fixtures__`).
 *
 * A path is asked **relative to the tree being read** - a service's directory,
 * a package of its extent, a clone - and never as an absolute path, so a
 * checkout that happens to live under somebody's `~/tests/` is not a test, and
 * a package named `e2e` is read as the package it is by whoever reads it from
 * its own directory.
 *
 * The harness imports this from the built package; it keeps no copy.
 */
const TEST_FILE_NAME = /\.(?:[A-Za-z0-9]+-)*(?:test|spec|e2e)(?:-[A-Za-z0-9]+)*\./;

/** Directory names that only ever hold tests, their runners' files and their data. */
const TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '__snapshots__',
  'e2e',
  'cypress',
  'playwright',
  'fixtures',
  '__fixtures__',
]);

/** True when a directory, by its name alone, holds tests. */
export const isTestDirectory = (name: string): boolean => TEST_DIRECTORIES.has(name);

/** True when a file's name alone says it is a test: `a.test.ts`, `a.integration-test.ts`. */
export const isTestName = (name: string): boolean => TEST_FILE_NAME.test(name);

/**
 * True when a path, relative to the tree being read, is a test: by its name, or
 * by a directory it is in.
 */
export const isTestFile = (path: string): boolean => {
  const segments = path.split(/[\\/]/);
  const name = segments.pop() ?? '';
  return isTestName(name) || segments.some(isTestDirectory);
};
