// The page's pictures in docs/media: the still the docs and the site preview
// use, and the tour the READMEs open on. Taken of the page
// scripts/demo/page-project.sh writes, in a headless Chrome (chrome.mjs).
//
//   node scripts/demo/page-tour.mjs <page.html> [docs/media]
//
// A tour is a list of steps; each one does something a reader would do, a
// caption says what it shows, and the frame is held for as long as it takes
// to read. The pointer is drawn into the page, since a headless browser has
// none. Needs ffmpeg for the GIF.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPage } from './chrome.mjs';

const [pagePath, outDir = 'docs/media'] = process.argv.slice(2);
if (!pagePath) {
  console.error('usage: node scripts/demo/page-tour.mjs <page.html> [out-dir]');
  process.exit(2);
}
const pageUrl = pathToFileURL(resolve(pagePath)).href;
const out = resolve(outDir);

const OVERLAY = `(() => {
  if (document.getElementById('tour-caption')) return;
  const bar = document.createElement('div');
  bar.id = 'tour-caption';
  Object.assign(bar.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0', padding: '9px 16px', zIndex: '2147483647',
    background: '#f2c94c', color: '#15130c', font: '600 16px/1.35 system-ui, sans-serif', textAlign: 'center',
  });
  const pointer = document.createElement('div');
  pointer.id = 'tour-pointer';
  pointer.innerHTML = '<svg width="20" height="26" viewBox="0 0 20 26"><path d="M1 1v20l5-5 4 9 3.4-1.5-4-8.8H16z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(pointer.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: '2147483647', pointerEvents: 'none' });
  document.body.append(bar, pointer);
})()`;

/**
 * Runs the steps on a fresh page. A GIF holds a frame per step that says how
 * long to hold it, and six on the way to each click; a still is the page
 * once every step is done, with no caption and no pointer.
 */
const run = async (name, { width, height, start, steps }, { gif = true } = {}) => {
  const frames = mkdtempSync(join(tmpdir(), 'flowatlas-tour-'));
  const page = await openPage(pageUrl + start, { width, height });
  if (gif) await page.evaluate(OVERLAY);
  const list = [];
  let at = { x: width * 0.6, y: height * 0.5 };
  const frame = async (seconds) => {
    if (!gif) return;
    const file = join(frames, `${String(list.length).padStart(3, '0')}.png`);
    await page.png(file);
    list.push({ file, seconds });
  };
  const pointTo = async (to) => {
    for (let i = 1; i <= 6; i += 1) {
      const x = at.x + ((to.x - at.x) * i) / 6;
      const y = at.y + ((to.y - at.y) * i) / 6;
      if (gif) await page.evaluate(`Object.assign(document.getElementById('tour-pointer').style, { left: '${x - 2}px', top: '${y - 2}px' })`);
      await page.move(x, y);
      await frame(0.06);
    }
    at = to;
  };
  for (const step of steps) {
    if (gif && step.caption) {
      await page.evaluate(`document.getElementById('tour-caption').textContent = ${JSON.stringify(step.caption)}`);
    }
    if (step.click) {
      const to = await page.centre(...step.click);
      await pointTo(to);
      await page.click(to.x, to.y);
    }
    if (step.type) await page.type(step.type);
    if (step.run) await page.evaluate(step.run);
    await page.wait(step.settle ?? 700);
    if (step.hold) await frame(step.hold);
  }
  if (!gif) await page.png(join(out, name));
  await page.close();

  if (gif) {
    // The concat demuxer takes each frame's duration from the line after it,
    // and the last frame has to be named twice for its own to count.
    const concat = join(frames, 'frames.txt');
    writeFileSync(concat, [...list, list[list.length - 1]]
      .map((f, i) => `file '${f.file}'` + (i < list.length ? `\nduration ${f.seconds}` : '')).join('\n') + '\n');
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
      '-vf', 'split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=none',
      '-loop', '0', join(out, name),
    ]);
  }
  rmSync(frames, { recursive: true, force: true });
  console.log(`   ${join(outDir, name)}`);
};

const button = (text) => ['button', text];
const busiest = ['#start a', 'POST /orders/:param/invoice'];
const closeStart = "document.querySelector('#start button')?.click()";

// The still: Steps on the busiest way in, with what ran beside each step.
await run('10-visualise.png', {
  width: 1500,
  height: 840,
  start: '',
  steps: [{ click: busiest }, { run: closeStart }],
}, { gif: false });

await run('14-map-tour.gif', {
  width: 1280,
  height: 800,
  start: '',
  steps: [
    { caption: 'flowatlas visualise: four repositories read and joined into one page, with real traffic laid over it', hold: 4 },
    { click: button('*Full screen'), caption: 'The Map: every service, queue, table and outside call, laid out in call order', hold: 3.5 },
    { click: button('p95'), caption: 'Heat: every link coloured by its p95 in the traces', hold: 3.5 },
    { click: button('*Leave full screen'), settle: 400 },
    { click: busiest, caption: 'Start here opens the busiest way in: every step, how often it ran, its p95, what it can fail with', hold: 5 },
    { click: button('Waterfall'), caption: 'Waterfall: the same steps on a time axis, typical times side by side', hold: 4 },
    { click: button('Not joined'), caption: 'Not joined: what the reader could not follow, grouped by cause, each with what to do', hold: 4.5 },
    { click: ['input[placeholder^="Find a route"]'], type: 'invoice', caption: 'One search: routes, channels, tables, types, gaps, classes', hold: 3.5 },
    { click: ['li.find-hit', '*POST /orders/:param/invoice'], settle: 500 },
    { click: button('Graph'), caption: 'Graph: the route and the services around it, what it can fail with', settle: 500 },
    { click: button('*Full screen'), hold: 4 },
    { click: button('*Types'), caption: 'Types: what each step takes and gives back, field by field', hold: 5 },
  ],
});
