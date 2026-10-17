#!/usr/bin/env node
/**
 * Copies the page's parts beside the built command (P103).
 *
 *   node scripts/page-parts.mjs
 *
 * `flowatlas visualise` writes one page from `page.html`, its `page.css`, the
 * logic modules and one module per panel (`PAGE_PARTS` in
 * packages/cli/src/commands/visualise.ts). The bundle holds none of them: they
 * are read as text when a page is written, from `dist/visualise/` once built.
 * So every `*.html`, `*.css` and `*.js` of `src/visualise/` and of its
 * `panels/` is copied there, and core's prompt renderer beside them - a whole
 * folder rather than a list, so a panel added later ships without anyone
 * remembering to name it here. A shell glob would do the same, but not the
 * same way on every shell a contributor builds from.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'packages', 'cli', 'src', 'visualise');
const to = join(root, 'packages', 'cli', 'dist', 'visualise');

/** A part of the page: markup, styles or a module, never a test or a type. */
const isPart = (name) => /\.(html|css|js)$/.test(name) && !/\.test\./.test(name);

let copied = 0;
for (const folder of ['', 'panels']) {
  mkdirSync(join(to, folder), { recursive: true });
  for (const name of readdirSync(join(from, folder)).filter(isPart)) {
    copyFileSync(join(from, folder, name), join(to, folder, name));
    copied += 1;
  }
}
copyFileSync(join(root, 'packages', 'core', 'dist', 'prompt-text.js'), join(to, 'prompt-text.js'));
console.log(`copied the page's ${copied + 1} parts beside the command`);
