/**
 * `fixtures/edit-breaks-other-repos` built, then edited, for the questions
 * about a change not yet committed (P387).
 *
 * The fixture is a project as it is built and, under `edits/`, the files an
 * assistant changes afterwards: the archive route renamed and the stock
 * message's `sku` sent under another key. The copy is built as the fixture
 * stands, so its graph and edit index are what a session starts with, and
 * the edits are then laid over the working tree, unbuilt: what `check_change`
 * compares and what the edit hook reads.
 *
 * The copy goes beside the fixtures, so it still resolves the type stubs
 * hoisted there, under a `.scratch-` name the repository ignores; the caller
 * removes it.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildProject } from '../packages/cli/dist/index.js';

/** Every file under `dir`, relative to it, in a stable order. */
const filesUnder = (dir, base = dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path, base) : [relative(base, path)];
    });

/**
 * Makes and builds the project under `fixtures/.scratch-edit-*`, lays the
 * edits over it, and says where its configuration, the project and the edits
 * are, with each edited file's text before and after.
 */
export const editedFixtureProject = async (root) => {
  const fixtures = join(root, 'fixtures');
  const fixture = join(fixtures, 'edit-breaks-other-repos');
  const scratch = mkdtempSync(join(fixtures, '.scratch-edit-'));
  const project = join(scratch, 'project');
  cpSync(fixture, project, {
    recursive: true,
    filter: (source) => !/[\\/](?:\.flowatlas|edits|expected\.[^\\/]+)$/.test(source),
  });
  const config = join(project, 'flowatlas.config.json');
  await buildProject({ config });
  const edits = join(fixture, 'edits');
  const edited = filesUnder(edits).map((file) => ({
    file,
    path: join(project, file),
    before: readFileSync(join(project, file), 'utf8'),
    after: readFileSync(join(edits, file), 'utf8'),
  }));
  cpSync(edits, project, { recursive: true });
  return { config, scratch, project, edited };
};
