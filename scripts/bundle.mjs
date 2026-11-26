#!/usr/bin/env node
/**
 * Builds the command as one file.
 *
 *   node scripts/bundle.mjs
 *
 * The other `@flowatlas/*` packages of the workspace are how the source is
 * organised, not something anybody should install. Publishing them would make
 * each of their exports a promise to somebody, and the first time a function
 * moves between two of them that promise breaks for a package nobody was meant
 * to import. So they are compiled into the command and the command is what
 * ships.
 *
 * Everything with a life of its own outside this project stays outside it: a
 * native module cannot be bundled at all, and the rest are ordinary
 * dependencies that npm should deduplicate against whatever else is installed.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'packages', 'cli');
const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));

/** Dependencies the command declares, which npm installs beside it. */
const external = Object.keys(manifest.dependencies ?? {});

// A package of this repository is bundled, never installed: they are private, so one left in `dependencies` is
// imported from a package npm does not have, and the published command fails to install. 0.7.0 was packed so once,
// `@flowatlas/graphql` among the dependencies; it belongs in `devDependencies` with the others.
const ours = external.filter((name) => name.startsWith('@flowatlas/'));
if (ours.length > 0) {
  console.error(`bundle: ${ours.join(', ')} in packages/cli dependencies would be installed from npm, which has none: move to devDependencies, which are bundled`);
  process.exit(1);
}

// The chunks are named by their hash, so a build over an earlier one leaves the
// earlier chunks beside the new ones, and `files: ["dist"]` would ship them all
// (P198): a release packed after an incremental build carried every chunk of
// the build before it. The output starts empty; `page-parts.mjs` refills
// `dist/visualise/` after this.
rmSync(join(cli, 'dist'), { recursive: true, force: true });

const result = await build({
  // The search and edit hooks are entries of their own (P227 D6, P387): a search or an edit runs one, and it must not load the command.
  // So is the prompt hook (P386): every prompt runs it, and only one naming something loads the graph server.
  entryPoints: [join(cli, 'src', 'index.ts'), join(cli, 'src', 'search-hook.ts'), join(cli, 'src', 'edit-hook.ts'), join(cli, 'src', 'prompt-hook.ts')],
  outdir: join(cli, 'dist'),
  bundle: true,
  // A dynamic import stays dynamic: the graph server is loaded by `flowatlas mcp`
  // and by nothing else, and an ESM `import` at the top of a bundle would have
  // it read on every command, `--version` included.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  // Read by `flowatlas visualise`, and by the version the command reports.
  loader: { '.html': 'text' },
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs);
const total = outputs.reduce((sum, [, out]) => sum + out.bytes, 0);
console.log(
  `bundled the command: ${Math.round(total / 1024)}KB over ${outputs.length} file(s), ` +
    `${external.length} dependencies left outside`,
);
