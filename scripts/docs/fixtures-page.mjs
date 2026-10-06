#!/usr/bin/env node
/**
 * The fixture catalogue on the project site: one page, built from the fixtures.
 *
 *   node scripts/docs/fixtures-page.mjs          # write docs/fixtures.html
 *   node scripts/docs/fixtures-page.mjs --check  # fail if the page is stale
 *
 * Every fixture is a small repository written to prove one shape the tool must
 * read, and its README says which. Read in a terminal, a hundred of them are a
 * directory listing; this puts them on one page, grouped by what they are about,
 * with the sentence that says what each proves.
 *
 * Generated rather than written, so it cannot say something the fixtures do not:
 * the sentence is the README's own, and `--check` runs in `pnpm check` the way a
 * snapshot does. A fixture added without a README is on the page as one, which
 * is the nudge to write it.
 *
 * The page states no result. Whether the fixtures pass is the CI badge's to say,
 * because a static page that printed "passing" would be true only on the day it
 * was built.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
const PAGE = join(ROOT, 'docs', 'fixtures.html');
const REPO = 'https://github.com/Panevschi-Ruslan/flowatlas';

/** Directories under `fixtures/` that are not fixtures. */
const NOT_FIXTURES = new Set(['node_modules', 'shared']);

/**
 * The area a fixture belongs to, by its name, first match wins.
 *
 * NestJS has most of the fixtures, so its brokers and data layers are filed with
 * the other brokers and data layers rather than under the framework.
 */
const AREAS = [
  ['Channels and messages', /^(nest-(kafka|rabbitmq|bullmq|redis|broker)|socket-|folded-|object-channels|fn-broker|sse-)/],
  ['Data layers', /^(nest-(typeorm|prisma|drizzle|mongoose|sequelize|kysely|knex|pg|mikro|leaves|unknown-orm|workspace-wrapper)|prisma-|pg-|db-|fn-data)/],
  ['Serverless, wired in Terraform', /^(lambda-|multi-repo-lambda)/],
  ['Several repositories', /^(multi-repo|same-service|ground-truth)/],
  ['Workspaces and monorepos', /^workspace-/],
  ['NestJS', /^nest-/],
  ['Express, Fastify, Koa and Hono', /^(express-|fastify-|koa-|hono-)/],
  ['Next.js and Medusa', /^(next-|medusa-)/],
  ['tRPC', /^trpc-/],
  ['React', /^react-/],
  ['Angular', /^angular-/],
  ['Everything else', /./],
];

const areaOf = (name) => AREAS.find(([, pattern]) => pattern.test(name))[0];

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The inline Markdown a README sentence uses: code and bold, nothing else. */
const inline = (text) =>
  escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/**
 * What a README says the fixture is for: the first sentence of its first
 * paragraph of prose, joined across the lines it wraps over.
 */
const purposeOf = (readme) => {
  const lines = readme.split('\n');
  const start = lines.findIndex(
    (line, index) => index > 0 && /^[^#\s|>-]/.test(line) && !line.startsWith('```'),
  );
  if (start === -1) return undefined;
  const paragraph = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') break;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(' ');
  // A full stop ends it; a colon does not, because what follows a colon is the
  // rest of the same sentence.
  const end = text.search(/\.(\s|$)/);
  const sentence = end === -1 ? text : text.slice(0, end + 1);
  // A paragraph that only introduces a list ends where the list starts.
  return sentence.replace(/:$/, '.');
};

/**
 * How many services a fixture holds: the ones its configuration lists, or one
 * repository read on its own when it has no configuration.
 */
const servicesOf = (dir) => {
  const config = join(dir, 'flowatlas.config.json');
  if (!existsSync(config)) return 1;
  const listed = JSON.parse(readFileSync(config, 'utf8')).services;
  return Array.isArray(listed) && listed.length > 0 ? listed.length : 1;
};

/** Every fixture, with what the page says about it, in name order. */
const readFixtures = () =>
  readdirSync(FIXTURES, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !NOT_FIXTURES.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = join(FIXTURES, name);
      const readme = join(dir, 'README.md');
      const snapshots = readdirSync(dir)
        .filter((file) => file.startsWith('expected.'))
        .sort();
      return {
        name,
        area: areaOf(name),
        purpose: existsSync(readme) ? purposeOf(readFileSync(readme, 'utf8')) : undefined,
        services: servicesOf(dir),
        snapshots,
      };
    });

const card = (fixture) => `      <li class="fixture" data-search="${escape(
  `${fixture.name} ${fixture.area} ${fixture.purpose ?? ''}`.toLowerCase(),
)}">
        <div class="head">
          <a class="name" href="${REPO}/tree/main/fixtures/${fixture.name}">${escape(fixture.name)}</a>
          <span class="kind">${fixture.services === 1 ? 'one service' : `${fixture.services} services`}</span>
        </div>
        <p>${fixture.purpose === undefined ? '<em>No README yet.</em>' : inline(fixture.purpose)}</p>
        <p class="snapshots">${
          fixture.snapshots.length === 0
            ? 'no snapshot'
            : fixture.snapshots.map((file) => `<code>${escape(file)}</code>`).join(' ')
        }</p>
      </li>`;

const render = (fixtures) => {
  const areas = AREAS.map(([area]) => [area, fixtures.filter((fixture) => fixture.area === area)]).filter(
    ([, list]) => list.length > 0,
  );
  const snapshotCount = fixtures.reduce((sum, fixture) => sum + fixture.snapshots.length, 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flowatlas fixtures</title>
<meta name="description" content="Every fixture flowatlas is tested against, grouped by what it proves.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>🗺️</text></svg>">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<!-- Generated by scripts/docs/fixtures-page.mjs from the fixtures' READMEs. Do not edit by hand. -->
<style>
:root {
  --paper: #f2f2f3; --surface: #ffffff; --ink: #1a1b1e; --muted: #64666c; --rule: #d9dadd;
  --accent: #7d2fa0; --accent-soft: #efe5f4;
  --shadow: 0 1px 2px rgba(20,18,24,.06), 0 8px 28px rgba(20,18,24,.07);
  --sans: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif;
  --serif: "Source Serif 4", Georgia, "Times New Roman", serif;
  --mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0b0c0d; --surface: #17181a; --ink: #e7e7e9; --muted: #93959b; --rule: #27292c;
    --accent: #c77ae6; --accent-soft: #23162b;
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.45);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #0b0c0d; --surface: #17181a; --ink: #e7e7e9; --muted: #93959b; --rule: #27292c;
  --accent: #c77ae6; --accent-soft: #23162b;
  --shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.45);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 var(--serif); }
main { max-width: 1080px; margin: 0 auto; padding: 40px 16px 80px; }
a { color: var(--accent); }
h1 { font: 800 clamp(30px, 5vw, 44px)/1.1 var(--sans); margin: 0 0 12px; }
h2 { font: 600 22px/1.2 var(--sans); margin: 40px 0 12px; }
h2 .count { color: var(--muted); font-weight: 600; }
.lede { max-width: 70ch; color: var(--muted); }
.meta { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; margin: 20px 0; font: 14px var(--sans); color: var(--muted); }
.meta img { display: block; }
code { font: 0.86em var(--mono); background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }
input[type=search] { width: 100%; font: 16px var(--sans); padding: 12px 14px; border: 1px solid var(--rule); border-radius: 10px; background: var(--surface); color: var(--ink); }
ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.fixture { background: var(--surface); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; box-shadow: var(--shadow); min-width: 0; }
.fixture p { margin: 8px 0 0; overflow-wrap: anywhere; }
.head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.name { font: 500 15px var(--mono); text-decoration: none; overflow-wrap: anywhere; }
.kind { font: 13px var(--sans); color: var(--muted); }
.snapshots { font-size: 13px; color: var(--muted); }
.snapshots code { background: none; padding: 0 4px 0 0; }
.hidden { display: none; }
footer { margin-top: 48px; font: 14px var(--sans); color: var(--muted); }
</style>
</head>
<body>
<main>
  <p><a href="./">← flowatlas</a></p>
  <h1>Fixtures</h1>
  <p class="lede">Each fixture is a small repository written to prove one shape the tool must read. Its
  README says which, and the sentence below is the README's own. Every fixture is built by the real
  command line and compared, line by line, with the snapshots named under it, on every push.</p>
  <div class="meta">
    <a href="${REPO}/actions/workflows/check.yml"><img src="${REPO}/actions/workflows/check.yml/badge.svg" alt="check status" height="20"></a>
    <span>${fixtures.length} fixtures</span>
    <span>${snapshotCount} snapshot files</span>
    <span>${areas.length} areas</span>
  </div>
  <input type="search" id="filter" placeholder="Filter by name or by what it proves — prisma, route, workspace…" aria-label="Filter fixtures">
${areas
  .map(
    ([area, list]) => `  <section data-area>
    <h2>${escape(area)} <span class="count" data-total="${list.length}">${list.length}</span></h2>
    <ul>
${list.map(card).join('\n')}
    </ul>
  </section>`,
  )
  .join('\n')}
  <footer>Generated from <code>fixtures/*/README.md</code> by <code>scripts/docs/fixtures-page.mjs</code>;
  <code>pnpm check</code> fails when this page is out of date.</footer>
</main>
<script>
const filter = document.getElementById('filter');
filter.addEventListener('input', () => {
  const words = filter.value.toLowerCase().split(/\\s+/).filter(Boolean);
  for (const section of document.querySelectorAll('[data-area]')) {
    let shown = 0;
    for (const item of section.querySelectorAll('.fixture')) {
      const hit = words.every((word) => item.dataset.search.includes(word));
      item.classList.toggle('hidden', !hit);
      if (hit) shown += 1;
    }
    section.classList.toggle('hidden', shown === 0);
    const count = section.querySelector('.count');
    count.textContent = words.length === 0 ? count.dataset.total : shown + ' of ' + count.dataset.total;
  }
});
</script>
</body>
</html>
`;
};

const page = render(readFixtures());
if (process.argv.includes('--check')) {
  const committed = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';
  if (committed !== page) {
    console.error(
      'docs/fixtures.html is out of date with the fixtures. Run `node scripts/docs/fixtures-page.mjs` and commit it.',
    );
    process.exit(1);
  }
  console.log('fixtures page ok');
} else {
  writeFileSync(PAGE, page, 'utf8');
  console.log(`wrote docs/fixtures.html`);
}
