/**
 * Claude Code in print mode, as the benchmark's assistant (P238).
 *
 * One session is one `claude -p` in a workspace of its own, with the stream of
 * events read as it comes: the model the session ran on, every tool it called,
 * the tokens and the time, and the final answer. What is turned off is turned
 * off the same way for every arm:
 *
 * - `--setting-sources project,local`: the person's own settings, hooks and
 *   plugins stay out; the workspace's own (the search hook, in the graph arms)
 *   stay in.
 * - `--strict-mcp-config`: the person's MCP servers stay out; the graph arms
 *   are handed the one server they are measuring.
 * - `--permission-mode dontAsk` with a list of reading tools: an arm can read
 *   and search, and nothing can write, fetch or run anything else.
 * - `--no-session-persistence`: nothing is kept to resume from.
 *
 * It runs on the subscription the person is signed in with; nothing here
 * reads or passes a key.
 */
import { spawn } from 'node:child_process';

export const name = 'claude-code';

/**
 * The command to run: `claude`, or what `FLOWATLAS_BENCH_CLAUDE` names - a
 * stand-in script for the runner's own test, which runs no assistant.
 */
const command = () => {
  const named = process.env['FLOWATLAS_BENCH_CLAUDE'];
  if (named === undefined || named === '') return { file: 'claude', prefix: [] };
  return named.endsWith('.mjs') ? { file: process.execPath, prefix: [named] } : { file: named, prefix: [] };
};

/** The tools every arm may use: reading and searching, by tool or by shell. */
export const READING_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'Bash(grep:*)', 'Bash(rg:*)', 'Bash(find:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)'];

/** A usage limit says so in the result; the run stops there and resumes later. */
const LIMIT = /usage limit|limit reached|rate limit|out of (?:usage|credits)|try again (?:at|in)\b/i;

export const argsFor = ({ prompt, model, mcpConfig, graph }) => [
  '-p',
  prompt,
  '--output-format',
  'stream-json',
  '--verbose',
  '--model',
  model,
  '--setting-sources',
  'project,local',
  '--strict-mcp-config',
  '--mcp-config',
  mcpConfig,
  '--permission-mode',
  'dontAsk',
  '--allowedTools',
  [...READING_TOOLS, ...(graph ? ['mcp__flowatlas'] : [])].join(','),
  '--no-session-persistence',
];

/** The events of one session, read into what the benchmark records. */
export const readEvents = (lines) => {
  const out = { model: undefined, mcp: [], tools: {}, turns: 0, answer: '', isError: false, usage: undefined, costUsd: undefined, durationMs: undefined, limit: false };
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'system' && event.subtype === 'init') {
      out.model = event.model;
      out.mcp = (event.mcp_servers ?? []).map((server) => ({ name: server.name, status: server.status }));
    } else if (event.type === 'assistant') {
      for (const part of event.message?.content ?? []) {
        if (part.type === 'tool_use') out.tools[part.name] = (out.tools[part.name] ?? 0) + 1;
      }
    } else if (event.type === 'result') {
      out.answer = typeof event.result === 'string' ? event.result : '';
      out.isError = event.is_error === true;
      out.turns = event.num_turns ?? 0;
      out.costUsd = event.total_cost_usd;
      out.durationMs = event.duration_ms;
      out.usage = event.usage;
      out.limit = out.isError && LIMIT.test(out.answer);
    }
  }
  return out;
};

/** The command's own version, for the report. */
export const version = () =>
  new Promise((done) => {
    const { file, prefix } = command();
    const child = spawn(file, [...prefix, '--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    child.stdout.on('data', (chunk) => (text += chunk));
    child.on('error', () => done(undefined));
    child.on('close', () => done(text.trim() || undefined));
  });

/**
 * One session, to the end or to the timeout. The raw stream is handed to
 * `keep` as it comes, so the transcript is on disk even when the session is
 * killed.
 */
export const runSession = ({ cwd, prompt, model, mcpConfig, graph, timeoutMs, keep }) =>
  new Promise((done) => {
    const started = Date.now();
    const { file, prefix } = command();
    const child = spawn(file, [...prefix, ...argsFor({ prompt, model, mcpConfig, graph })], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FLOWATLAS_LOG_QUESTIONS: '1' } });
    const lines = [];
    let pending = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const parts = pending.split('\n');
      pending = parts.pop();
      for (const part of parts) {
        lines.push(part);
        keep?.(`${part}\n`);
      }
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ outcome: 'error', error: error.message, ms: Date.now() - started, ...readEvents([]) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending !== '') lines.push(pending);
      const read = readEvents(lines);
      const outcome = timedOut ? 'timeout' : read.limit ? 'limit' : code !== 0 || read.isError ? 'error' : 'answered';
      done({ outcome, ms: Date.now() - started, exitCode: code, ...(outcome === 'error' ? { error: (stderr || read.answer).slice(0, 500) } : {}), ...read });
    });
  });
