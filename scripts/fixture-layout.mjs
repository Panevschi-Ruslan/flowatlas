/**
 * What kind of fixture a directory holds, how the tool is run over it, and
 * where that run writes.
 *
 * One table, read by `fixtures-run.mjs` and by `fixtures-check.mjs`, because the
 * two had a judgement each and the judgements disagreed. The runner decided a
 * fixture was a repository by its `package.json`; the checker decided it was one
 * by whether it had a `src/` directory, and pointed the comparison at
 * `<fixture>/.none/graph.json` when it did not. A Next.js fixture with `app/`
 * and no `src/` was therefore run on every build, produced a graph, and was
 * compared against a file that does not exist - validated for shape, compared
 * never (R120). The gate had been printing the evidence the whole time, as two
 * counts that differed and that nobody had to explain.
 *
 * So the question "can this fixture be run, and with what?" is answered in one
 * place. A fixture's sources are found by what the fixture declares - a
 * manifest, or a configuration - and never by the name of a directory inside it,
 * which is the framework's business and not this repository's.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Where a run writes, for every fixture the tool can be run over at all. */
export const OUTPUT = '.flowatlas';

/**
 * One row per way a fixture can be produced, in precedence order.
 *
 * `marker` is what the fixture declares about itself, and it is the whole of the
 * detection: a configuration means a project of several repositories, read by
 * `build`; a manifest alone means one repository, read by `extract`. A fixture
 * that has both is a project, which is why this is an ordered list and not an
 * object.
 *
 * `steps` are the commands, in order, so that the two scripts cannot drift on
 * how a fixture is run either. Each names the argument vector (`args`) and the
 * files it leaves in the output directory (`writes`). The runner removes those
 * files before the step runs: `pnpm clean` empties `dist` and nothing else, so a
 * step that stopped producing its file would otherwise leave last week's copy
 * behind, and the checker would compare the snapshot against that and pass.
 *
 * A step that `mayDecline` is allowed to exit with the tool's "cannot run" code
 * and write nothing. `contracts` is one: it refuses a graph that holds no types,
 * which a third of the project fixtures are, and says so rather than answering
 * "nothing is broken". Declining is only harmless where nobody holds a snapshot
 * of the answer - a fixture that does gets a snapshot validated and compared
 * never, which the checker refuses.
 *
 * `neutral` is a configuration with nothing in it: `extract` searches upward for
 * one and would otherwise find this repository's own.
 */
const KINDS = [
  {
    kind: 'project',
    marker: 'flowatlas.config.json',
    steps: [
      {
        args: (dir) => ['build', '--config', join(dir, 'flowatlas.config.json')],
        writes: ['project-graph.json', 'link-report.json'],
      },
      {
        // What R126 and R133 reported per fixture - which boundaries were
        // compared, which were left unchecked and why - reproduced only when
        // somebody ran this by hand until it was a step of the run.
        args: (dir) => ['contracts', '--config', join(dir, 'flowatlas.config.json')],
        writes: ['contracts.json'],
        mayDecline: true,
      },
    ],
  },
  {
    kind: 'repo',
    marker: 'package.json',
    steps: [
      {
        args: (dir, { neutral }) => ['extract', relative(root, dir), '--config', neutral],
        writes: ['graph.json'],
      },
    ],
  },
];

/** The exit code of a command that could not answer, as opposed to one that failed. */
export const CANNOT_RUN = 2;

/** Nothing to run: a hand-written sample of the schema, or a bare directory. */
const NOT_RUN = { kind: 'none', steps: [] };

/**
 * How this fixture is produced. `kind` is `'project'`, `'repo'` or `'none'`.
 *
 * A fixture of no kind is the one case where a snapshot legitimately cannot be
 * compared, and `fixtures-check.mjs` makes every such fixture say why.
 */
export const layoutOf = (dir) => KINDS.find(({ marker }) => isFile(join(dir, marker))) ?? NOT_RUN;

/** Where a run over this fixture writes its graphs and its report. */
export const outputDir = (dir) => join(dir, OUTPUT);

/** Every fixture directory, or the ones named on the command line. */
export const fixtureDirs = (selected = []) => {
  if (selected.length > 0) return selected.map((path) => join(root, path));
  try {
    return readdirSync(join(root, 'fixtures'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => join(root, 'fixtures', entry.name));
  } catch {
    return [];
  }
};
