#!/usr/bin/env node
/**
 * Builds the command as one file.
 *
 *   node scripts/bundle.mjs
 *
 * The nine `@flowatlas/*` packages beside this one are how the source is
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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'packages', 'cli');
const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));

/** Dependencies the command declares, which npm installs beside it. */
const external = Object.keys(manifest.dependencies ?? {});

const result = await build({
  entryPoints: [join(cli, 'src', 'index.ts')],
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
