#!/usr/bin/env node
/**
 * Does flowatlas help an assistant answer, measured (P238).
 *
 *   node scripts/bench-agent/run.mjs --pilot            # 8 questions x 4 arms x 1 run
 *   node scripts/bench-agent/run.mjs --full --yes       # every question x 4 arms x 3 runs, after a pilot
 *   node scripts/bench-agent/run.mjs --resume <dir>     # go on where a usage limit stopped a run (with the same --work, if one was given)
 *   node scripts/bench-agent/run.mjs --dry              # no assistant: generator, key, scorers
 *
 * This is not part of `pnpm check` (its `--dry` is). It asks an assistant
 * questions, which spends the usage of whoever is signed in, so it is started
 * by a person, deliberately, before a release. A full run is refused until a
 * pilot from the same flowatlas build and model has been run, and it starts
 * only with that pilot's estimate on the screen and `--yes`.
 *
 * ## The arms
 *
 * | Arm | Workspace | flowatlas |
 * |---|---|---|
 * | A | every repository side by side | none |
 * | B | the repository the question is asked from | none |
 * | C | that repository | the graph of all of them, over MCP, and the guide |
 * | D | every repository | the graph, over MCP, and the guide |
 *
 * A gets search's best case, B its usual one. C is what a person in one
 * repository gets from the tool; D what the graph adds when search can see
 * everything too. C's server is handed the database alone, so it can say
 * where things are in every repository and can quote code only from the one
 * that is there, as a pulled team graph would. D's has the configuration.
 * The guide is what `flowatlas agents install --instructions --hook` writes.
 * Every arm gets the same prompt, the same model and the same tools for
 * reading, in a fresh copy of its workspace.
 *
 * ## What is kept
 *
 * `results/<date>-<kind>/run.json` (versions, model, seed, arms, questions)
 * and `sessions.jsonl`, one line per finished session: its score, the tools
 * it called, its tokens, time and cost. Transcripts are written to the work
 * directory and never committed; the report quotes only measures.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as claude from './adapters/claude-code.mjs';
import { runDry } from './dry.mjs';
import { writeProject } from './generate.mjs';
import { questionsFor } from './questions.mjs';
import { score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
const RESULTS_DIR = join(HERE, 'results');
export const EXPECTATIONS = join(HERE, 'expectations.md');
export const ARMS = ['A', 'B', 'C', 'D'];
export const RUN_FORMAT_VERSION = 1;

const DEFAULTS = { seed: 1, resources: 10, reps: 3, model: 'sonnet', pauseSeconds: 30, timeoutSeconds: 600 };

class UsageError extends Error {}

/** Where the runner says what it is doing; its test hands in its own. */
let say = (text) => process.stdout.write(text);

const parseArgs = (argv) => {
  const options = { ...DEFAULTS, arms: ARMS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new UsageError(`${flag} needs a value`);
      return next;
    };
    if (flag === '--pilot') options.kind = 'pilot';
    else if (flag === '--full') options.kind = 'full';
    else if (flag === '--dry') options.dry = true;
    else if (flag === '--yes') options.yes = true;
    else if (flag === '--resume') options.resume = value();
    else if (flag === '--seed') options.seed = Number(value());
    else if (flag === '--resources') options.resources = Number(value());
    else if (flag === '--reps') options.reps = Number(value());
    else if (flag === '--model') options.model = value();
    else if (flag === '--arms') options.arms = value().split(',');
    else if (flag === '--pause') options.pauseSeconds = Number(value());
    else if (flag === '--timeout') options.timeoutSeconds = Number(value());
    else if (flag === '--work') options.work = resolve(value());
    else if (flag === '--results') options.results = resolve(value());
    else throw new UsageError(`unknown flag ${flag}`);
  }
  for (const arm of options.arms) if (!ARMS.includes(arm)) throw new UsageError(`--arms takes ${ARMS.join(', ')}, not ${arm}`);
  return options;
};

/** The newest file under a directory with one of the endings, by modification time. */
const newestUnder = (dir, endings) => {
  let newest = 0;
  const visit = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') visit(path);
      } else if (endings.some((ending) => entry.name.endsWith(ending))) {
        newest = Math.max(newest, statSync(path).mtimeMs);
      }
    }
  };
  visit(dir);
  return newest;
};

/** A measurement of yesterday's build is refused, as the coverage harness refuses one. */
const refuseIfStale = () => {
  const built = newestUnder(join(ROOT, 'packages', 'cli', 'dist'), ['.js']);
  if (built === 0) throw new UsageError('there is no built command to measure. Run `pnpm -r build` first.');
  for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (newestUnder(join(ROOT, 'packages', entry.name, 'src'), ['.ts', '.tsx']) > built) {
      throw new UsageError(`packages/${entry.name}/src has changed since the command was built. Run \`pnpm -r build\` first, or this run measures the code as it was.`);
    }
  }
};

const flowatlasVersion = () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')).version;
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '';
  return { version, commit: `${commit}${dirty ? '+changes' : ''}` };
};

const flowatlas = (args, cwd) => {
  const done = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`flowatlas ${args.join(' ')} failed (${done.status}): ${(done.stderr || done.stdout).slice(-800)}`);
  return done.stdout;
};

/** The files the graph arms have and the others must not: the graph, its configuration, the key and the guide. */
const GRAPH_ONLY = new Set(['.flowatlas', 'key.json', 'flowatlas.config.json']);
const GUIDE = new Set(['.claude', 'CLAUDE.md', 'AGENTS.md', '.cursor', '.github', '.mcp.json']);

/**
 * The project twice: as generated, for the arms without the graph, and with
 * the graph built and the guide installed, for the arms with it.
 */
const prepare = (work, options) => {
  const plain = join(work, 'project');
  const graph = join(work, 'graph');
  if (!existsSync(join(plain, 'key.json'))) writeProject(plain, { seed: options.seed, resources: options.resources });
  if (!existsSync(join(graph, '.flowatlas', 'graph.db'))) {
    rmSync(graph, { recursive: true, force: true });
    cpSync(plain, graph, { recursive: true });
    flowatlas(['build', '--config', join(graph, 'flowatlas.config.json')], graph);
    flowatlas(['agents', 'install', '--config', join(graph, 'flowatlas.config.json'), '--instructions', '--hook'], graph);
  }
  const key = JSON.parse(readFileSync(join(plain, 'key.json'), 'utf8'));
  return { plain, graph, key };
};

/** A fresh copy of what one arm sees, and the MCP configuration it is handed. */
const workspaceFor = (prepared, question, arm, at) => {
  rmSync(at, { recursive: true, force: true });
  const withGraph = arm === 'C' || arm === 'D';
  const whole = arm === 'A' || arm === 'D';
  const from = withGraph ? prepared.graph : prepared.plain;
  const source = whole ? from : join(from, question.from);
  cpSync(source, at, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      if (GRAPH_ONLY.has(name) && dirname(path) === from) return false;
      return withGraph || !GUIDE.has(name);
    },
  });
  if (arm === 'D') {
    // The guide at the top of the workspace too, where the session starts: the gateway's is every repository's.
    for (const name of ['CLAUDE.md', '.claude']) {
      const guide = join(prepared.graph, 'gateway', name);
      if (existsSync(guide)) cpSync(guide, join(at, name), { recursive: true });
    }
  }
  const server = withGraph
    ? {
        flowatlas: {
          command: process.execPath,
          args: [CLI, 'mcp', ...(arm === 'C' ? ['--db', join(prepared.graph, '.flowatlas', 'graph.db')] : ['--config', join(prepared.graph, 'flowatlas.config.json')])],
          env: { FLOWATLAS_LOG_QUESTIONS: '1' },
        },
      }
    : {};
  const mcpConfig = `${at}.mcp-config.json`;
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: server }));
  return { cwd: at, mcpConfig, graph: withGraph };
};

const questionLog = (prepared) => join(prepared.graph, '.flowatlas', 'questions.jsonl');
const logLines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);

const today = () => new Date().toISOString().slice(0, 10);

const newRunDir = (results, kind) => {
  mkdirSync(results, { recursive: true });
  for (let n = 1; ; n += 1) {
    const dir = join(results, `${today()}-${kind}${n === 1 ? '' : `-${n}`}`);
    if (!existsSync(dir)) {
      mkdirSync(dir);
      return dir;
    }
  }
};

const readRuns = (results) =>
  existsSync(results)
    ? readdirSync(results)
        .sort()
        .filter((name) => existsSync(join(results, name, 'run.json')))
        .map((name) => ({ dir: join(results, name), run: JSON.parse(readFileSync(join(results, name, 'run.json'), 'utf8')) }))
    : [];

export const readSessions = (dir) => logLines(join(dir, 'sessions.jsonl')).map((line) => JSON.parse(line));

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

const tokensOf = (usage) => {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
};

/** What a full run would cost, from a pilot's sessions: per arm, the mean of each measure, times the full run's sessions. */
export const estimateFrom = (sessions, { questions, reps, pauseSeconds }) => {
  const byArm = {};
  for (const arm of ARMS) {
    const mine = sessions.filter((session) => session.arm === arm);
    if (mine.length === 0) continue;
    const mean = (pick) => mine.reduce((sum, session) => sum + pick(session), 0) / mine.length;
    byArm[arm] = { sessions: questions * reps, tokens: Math.round(mean((session) => session.tokens.total) * questions * reps), minutes: Math.round((mean((session) => session.ms) * questions * reps) / 60000), costUsd: Math.round(mean((session) => session.costUsd ?? 0) * questions * reps * 100) / 100 };
  }
  const arms = Object.values(byArm);
  const sessionsTotal = arms.reduce((sum, arm) => sum + arm.sessions, 0);
  return {
    byArm,
    sessions: sessionsTotal,
    tokens: arms.reduce((sum, arm) => sum + arm.tokens, 0),
    hours: Math.round(((arms.reduce((sum, arm) => sum + arm.minutes, 0) + (sessionsTotal * pauseSeconds) / 60) / 60) * 10) / 10,
    costUsd: Math.round(arms.reduce((sum, arm) => sum + arm.costUsd, 0) * 100) / 100,
  };
};

const sayEstimate = (estimate) => {
  const lines = [`a full run: ${estimate.sessions} sessions, about ${estimate.tokens.toLocaleString('en')} tokens and ${estimate.hours} hours with the pauses`];
  if (estimate.costUsd > 0) lines.push(`  priced at the rates the assistant reports: about $${estimate.costUsd} (on a subscription it spends usage limits, not money)`);
  for (const [arm, figures] of Object.entries(estimate.byArm)) lines.push(`  arm ${arm}: ${figures.sessions} sessions, ${figures.tokens.toLocaleString('en')} tokens, ${figures.minutes} min`);
  return lines.join('\n');
};

/** The full run's gate: a pilot of the same build and model, its estimate shown, and `--yes`. */
const pilotFor = (results, run) => {
  const pilots = readRuns(results).filter(({ run: other }) => other.kind === 'pilot' && other.flowatlas.commit === run.flowatlas.commit && other.modelRequested === run.modelRequested && other.seed === run.seed && other.done === true);
  return pilots[pilots.length - 1];
};

const runSessions = async (dir, run, workDir, prepared, questions) => {
  const done = new Set(readSessions(dir).map((session) => `${session.question}|${session.arm}|${session.rep}`));
  const plan = [];
  for (let rep = 1; rep <= run.reps; rep += 1) for (const question of questions) for (const arm of run.arms) plan.push({ question, arm, rep });
  const todo = plan.filter((step) => !done.has(`${step.question.id}|${step.arm}|${step.rep}`));
  say(`${plan.length - todo.length} of ${plan.length} sessions done; ${todo.length} to run\n`);
  const work = join(workDir, 'sessions', basename(dir));
  mkdirSync(work, { recursive: true });
  for (const [index, step] of todo.entries()) {
    const id = `${step.question.id}-${step.arm}-${step.rep}`;
    const space = workspaceFor(prepared, step.question, step.arm, join(work, id));
    const transcript = join(work, `${id}.jsonl`);
    rmSync(transcript, { force: true });
    const before = logLines(questionLog(prepared)).length;
    const result = await claude.runSession({
      cwd: space.cwd,
      prompt: step.question.prompt,
      model: run.modelRequested,
      mcpConfig: space.mcpConfig,
      graph: space.graph,
      timeoutMs: run.timeoutSeconds * 1000,
      keep: (text) => appendFileSync(transcript, text),
    });
    if (result.outcome === 'limit') {
      say(`stopped by a usage limit after ${index} of ${todo.length} sessions. Resume once it resets:\n  node scripts/bench-agent/run.mjs --resume ${dir}\n`);
      return false;
    }
    if (run.model === undefined && result.model !== undefined) {
      run.model = result.model;
      writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    } else if (result.model !== undefined && result.model !== run.model) {
      run.refused = `the model changed mid-run, from ${run.model} to ${result.model}; one model per report`;
      writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
      throw new UsageError(`${run.refused}. Start a new run.`);
    }
    const asked = logLines(questionLog(prepared)).slice(before).map((line) => JSON.parse(line));
    const tools = result.tools ?? {};
    const flowatlasCalls = Object.entries(tools).filter(([tool]) => tool.startsWith('mcp__flowatlas__')).reduce((sum, [, count]) => sum + count, 0);
    const mcpUp = !space.graph || result.mcp.some((server) => server.name === 'flowatlas' && server.status === 'connected');
    const marked = result.outcome === 'answered' && mcpUp ? score(step.question, result.answer) : { score: 0, correct: false, by: 'unscored' };
    const line = {
      question: step.question.id,
      kind: step.question.kind,
      group: step.question.group,
      arm: step.arm,
      rep: step.rep,
      at: new Date().toISOString(),
      model: result.model ?? null,
      outcome: mcpUp ? result.outcome : 'mcp-not-connected',
      score: marked.score,
      correct: marked.correct,
      by: marked.by,
      ...(marked.precision === undefined ? {} : { precision: marked.precision, recall: marked.recall }),
      answerLine: (result.answer.match(/^\s*\**ANSWER:?\**.*$/gim) ?? []).pop()?.slice(0, 2000) ?? null,
      tools,
      toolCalls: Object.values(tools).reduce((sum, count) => sum + count, 0),
      flowatlasCalls,
      flowatlasAnswerChars: asked.reduce((sum, entry) => sum + (entry.chars ?? 0), 0),
      tokens: tokensOf(result.usage),
      turns: result.turns,
      ms: result.durationMs ?? result.ms,
      costUsd: result.costUsd ?? null,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
    appendFileSync(join(dir, 'sessions.jsonl'), `${JSON.stringify(line)}\n`);
    rmSync(space.cwd, { recursive: true, force: true });
    rmSync(space.mcpConfig, { force: true });
    say(`${index + 1}/${todo.length} ${id}: ${line.outcome}, score ${line.score}, ${line.toolCalls} tool calls (${flowatlasCalls} flowatlas), ${line.tokens.total} tokens, ${Math.round(line.ms / 1000)}s\n`);
    if (index < todo.length - 1) await new Promise((wake) => setTimeout(wake, run.pauseSeconds * 1000));
  }
  return true;
};

export const main = async (argv = process.argv.slice(2), io = {}) => {
  say = io.say ?? ((text) => process.stdout.write(text));
  const options = parseArgs(argv);
  if (options.dry) {
    const result = await runDry();
    say(`${result.lines.join('\n')}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return undefined;
  }
  if (options.resume === undefined && options.kind === undefined) throw new UsageError('say --pilot, --full, --resume <dir> or --dry');
  if (!existsSync(EXPECTATIONS)) throw new UsageError('scripts/bench-agent/expectations.md is missing: the expectations are written down before anything is run');
  refuseIfStale();
  let dir;
  let run;
  if (options.resume !== undefined) {
    dir = resolve(options.resume);
    run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    if (run.refused !== undefined) throw new UsageError(`this run was refused: ${run.refused}`);
    if (run.flowatlas.commit !== flowatlasVersion().commit) throw new UsageError(`this run measured flowatlas ${run.flowatlas.commit} and the tree is now ${flowatlasVersion().commit}; one build per report`);
  } else {
    run = {
      runFormatVersion: RUN_FORMAT_VERSION,
      kind: options.kind,
      started: new Date().toISOString(),
      flowatlas: flowatlasVersion(),
      assistant: { name: claude.name, version: await claude.version() },
      modelRequested: options.model,
      seed: options.seed,
      resources: options.resources,
      reps: options.kind === 'pilot' ? 1 : options.reps,
      arms: options.arms,
      pauseSeconds: options.pauseSeconds,
      timeoutSeconds: options.timeoutSeconds,
      guide: 'skill + instructions + search hook (flowatlas agents install --instructions --hook)',
    };
    if (run.assistant.version === undefined) throw new UsageError('the `claude` command was not found; the benchmark drives Claude Code in print mode');
    if (options.kind === 'full') {
      const pilot = pilotFor(options.results ?? RESULTS_DIR, run);
      if (pilot === undefined) throw new UsageError(`no finished pilot of flowatlas ${run.flowatlas.commit} with --model ${run.modelRequested} and seed ${run.seed}: run --pilot first`);
      const estimate = JSON.parse(readFileSync(join(pilot.dir, 'estimate.json'), 'utf8'));
      say(`${sayEstimate(estimate)}\n  (from ${basename(pilot.dir)})\n`);
      if (options.yes !== true) {
        say('start it with --yes once that is a cost worth paying.\n');
        return undefined;
      }
      run.pilot = basename(pilot.dir);
    }
    dir = newRunDir(options.results ?? RESULTS_DIR, options.kind);
  }
  // Not kept in run.json, which is committed: a path on this machine says nothing about the run.
  const workDir = options.work ?? join(tmpdir(), 'flowatlas-bench-agent', `seed-${run.seed}-r${run.resources}`);
  mkdirSync(workDir, { recursive: true });
  const prepared = prepare(workDir, run);
  const all = questionsFor(prepared.key);
  const questions = run.kind === 'pilot' ? all.filter((question) => question.pilot) : all;
  run.questions ??= questions.map((question) => question.id);
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  const finished = await runSessions(dir, run, workDir, prepared, questions.filter((question) => run.questions.includes(question.id)));
  if (!finished) return { dir, done: false };
  run.done = true;
  run.finished = new Date().toISOString();
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  if (run.kind === 'pilot') {
    const estimate = estimateFrom(readSessions(dir), { questions: all.length, reps: DEFAULTS.reps, pauseSeconds: run.pauseSeconds });
    writeFileSync(join(dir, 'estimate.json'), `${JSON.stringify(estimate, null, 2)}\n`);
    say(`pilot done.\n${sayEstimate(estimate)}\nnode scripts/bench-agent/report.mjs ${dir} shows what it found.\n`);
  } else {
    say(`run done. node scripts/bench-agent/report.mjs ${dir} writes docs/benchmark.md.\n`);
  }
  return { dir, done: true };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}

export { median, tokensOf, UsageError };
