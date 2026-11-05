/*
 * The action's second step (P231): run flowatlas diff as a pull request's
 * comment, check the docs when asked, keep one comment up to date (or write
 * the job summary when the run cannot comment), hand on the outputs, and fail
 * the check on the breaks it was told to fail on.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canComment, markerOf, nothingChanged, outputLines, saysSomething, upsertComment } from './lib.mjs';

const input = (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? '';
const configPath = process.env.FLOWATLAS_CONFIG ?? resolve(input('config') || 'flowatlas.config.json');
const base = process.env.FLOWATLAS_BASE ?? input('base');
const failOn = new Set(input('fail-on').split(',').map((item) => item.trim()).filter((item) => item !== ''));
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8') || '{}');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const outputDir = resolve(dirname(configPath), config.output ?? '.flowatlas');
const commentFile = join(outputDir, 'pull-request-comment.md');

const flowatlas = (args) => spawnSync('flowatlas', args, { stdio: ['ignore', 'inherit', 'inherit'] }).status ?? 2;

const diffArgs = [
  'diff',
  base,
  '--config',
  configPath,
  '--format',
  'comment',
  '--output',
  commentFile,
  ...(input('max-chars') === '' ? [] : ['--max-chars', input('max-chars')]),
  ...(failOn.has('contract-break') ? ['--fail-on-contract-break'] : []),
  ...(failOn.has('rule-break') ? ['--fail-on-rule-break'] : []),
];
const diffExit = flowatlas(diffArgs);
if (diffExit === 2 || !existsSync(commentFile)) {
  console.log('::error::flowatlas diff could not run; the comment is left as it was');
  process.exit(2);
}

// SARIF for code scanning, when asked: the new and fixed findings, beside the comment.
if (input('sarif') === 'true') {
  flowatlas(['diff', base, '--config', configPath, '--format', 'sarif', '--output', join(outputDir, 'flowatlas.sarif')]);
}
const docsExit = input('docs-check') === 'true' ? flowatlas(['docs', '--check', '--config', configPath, '--format', 'github']) : 0;

const facts = JSON.parse(readFileSync(join(outputDir, 'diff-comment.json'), 'utf8'));
const written = readFileSync(commentFile, 'utf8');
const quiet = input('comment-when') !== 'always' && !saysSomething(facts);
const body = quiet ? nothingChanged(markerOf(written), base) : written;

// The job summary, every time: the one place a fork's pull request can be told.
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', `${body}\n`);

let url;
const mode = input('comment') || 'update';
if (mode !== 'off') {
  if (!canComment(event, process.env.GITHUB_REPOSITORY)) {
    console.log('::notice::a pull request from a fork has no token that can comment; the report is in the job summary');
  } else {
    try {
      const done = await upsertComment({ token: input('token'), repo: process.env.GITHUB_REPOSITORY, pr: event.pull_request.number, body, mode, quiet });
      url = done.url;
      console.log(`comment ${done.action}${url === undefined ? '' : `: ${url}`}`);
    } catch (error) {
      console.log(`::warning::could not comment (${error.message}); give the job pull-requests: write. The report is in the job summary`);
    }
  }
}

appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `${outputLines(facts, url)}\n`);
process.exit(diffExit !== 0 ? diffExit : docsExit);
