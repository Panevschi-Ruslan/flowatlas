#!/usr/bin/env node
/**
 * Does flowatlas help an assistant answer, measured (P238).
 *
 *   node scripts/bench-agent/run.mjs --pilot            # 8 questions x 4 arms x 1 run
 *   node scripts/bench-agent/run.mjs --full --yes       # every question x 4 arms x 3 runs, after a pilot
 *   node scripts/bench-agent/run.mjs --resume <dir>     # go on where a usage limit stopped a run (with the same --work, if one was given)
 *   node scripts/bench-agent/run.mjs --dry              # no assistant: generator, key, scorers
 *   ... --pilot --prompt-cards                          # the graph arms with prompt cards too (P386)
 *   ... --pilot --arms A,D,E,F,G                        # the terminal, prompt-card and four-upfront arms too (P392)
 *   ... --pilot --kinds find-the-bug,change-files       # only the questions of these kinds (P392)
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
 * | E | every repository | the graph through the terminal only: no server, the guide spells the commands (P392) |
 * | F | every repository | D, and prompt cards: the graph's answer for what a prompt names, before the first turn (P392) |
 * | G | every repository | D, with four core tools upfront (who_calls, impact, search, get_flow) instead of nine (P392) |
 *
 * A gets search's best case, B its usual one. C is what a person in one
 * repository gets from the tool; D what the graph adds when search can see
 * everything too. C's server is handed the database alone, so it can say
 * where things are in every repository and can quote code only from the one
 * that is there, as a pulled team graph would. D's has the configuration.
 * The guide is what `flowatlas agents install --instructions --hook` writes,
 * with `--no-prompt-cards` unless the run is started with `--prompt-cards`
 * (P386): the prompt hook then hands the graph arms the graph's answer for
 * what a question names before the first turn, and `run.json` says so, so a
 * run with cards is compared with one without.
 * Every arm gets the same prompt, the same model and the same tools for
 * reading, in a fresh copy of its workspace.
 *
 * E, F and G are run only when asked (`--arms`), each against D, which they
 * change one thing of (P392): E asks the graph with the commands through
 * the shell (`flowatlas agents install --terminal`; the only shell command
 * it is granted beyond reading is `flowatlas`, run against its graph), F
 * installs the prompt hook, G lists four tools upfront (`mcp.upfront`). Each
 * has a graph of its own, built and guided once per work directory, so D
 * stays exactly what it was. What every session's turns went on is
 * classified from its transcript (`turns.mjs`) and kept with its measures.
 *
 * ## What is kept
 *
 * `results/<date>-<kind>/run.json` (versions, model, seed, arms, questions)
 * and `sessions.jsonl`, one line per finished session: its score, the tools
 * it called, its tokens, time and cost. Transcripts are written to the work
 * directory and never committed; the report quotes only measures.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as claude from './adapters/claude-code.mjs';
import { runDry } from './dry.mjs';
import { writeProject } from './generate.mjs';
import { questionsFor } from './questions.mjs';
import { score } from './score.mjs';
import { classify, graphTool, readTranscript } from './turns.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
const RESULTS_DIR = join(HERE, 'results');
/** The kinds of question, in the order the report lists them (P392 added the last three). */
export const KINDS = ['cross-repo-callers', 'blast-radius', 'event-handlers', 'dead', 'contract', 'settings', 'single-repo', 'code-text', 'explain', 'find-the-bug', 'change-files', 'navigation'];
export const EXPECTATIONS = join(HERE, 'expectations.md');
export const ARMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** The arms a run asks unless `--arms` says others: the four every report has compared. */
export const DEFAULT_ARMS = ['A', 'B', 'C', 'D'];
export const RUN_FORMAT_VERSION = 2;

/**
 * What each arm is (P392): the workspace it sees (every repository, or the
 * one the question is asked from), how it asks the graph (not at all, the
 * server, or the commands in a terminal), and which graph it asks - each a
 * copy of the project built and guided its own way.
 */
export const ARM_SETUPS = {
  A: { whole: true, graph: 'none' },
  B: { whole: false, graph: 'none' },
  C: { whole: false, graph: 'mcp', variant: 'graph' },
  D: { whole: true, graph: 'mcp', variant: 'graph' },
  E: { whole: true, graph: 'terminal', variant: 'graph-terminal' },
  F: { whole: true, graph: 'mcp', variant: 'graph-cards' },
  G: { whole: true, graph: 'mcp', variant: 'graph-upfront' },
};

/** The core tools arm G lists upfront (P-1 b of the research: the few most questions take). */
export const UPFRONT_FOUR = ['who_calls', 'impact', 'search', 'get_flow'];

const DEFAULTS = { seed: 1, resources: 10, reps: 3, model: 'sonnet', pauseSeconds: 30, timeoutSeconds: 600 };

class UsageError extends Error {}

/** Where the runner says what it is doing; its test hands in its own. */
let say = (text) => process.stdout.write(text);

const parseArgs = (argv) => {
  const options = { ...DEFAULTS, arms: DEFAULT_ARMS };
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
    else if (flag === '--prompt-cards') options.promptCards = true;
    else if (flag === '--resume') options.resume = value();
    else if (flag === '--seed') options.seed = Number(value());
    else if (flag === '--resources') options.resources = Number(value());
    else if (flag === '--reps') options.reps = Number(value());
    else if (flag === '--model') options.model = value();
    else if (flag === '--arms') options.arms = value().split(',');
    else if (flag === '--kinds') options.kinds = value().split(',');
    else if (flag === '--pause') options.pauseSeconds = Number(value());
    else if (flag === '--timeout') options.timeoutSeconds = Number(value());
    else if (flag === '--work') options.work = resolve(value());
    else if (flag === '--results') options.results = resolve(value());
    else throw new UsageError(`unknown flag ${flag}`);
  }
  for (const arm of options.arms) if (!ARMS.includes(arm)) throw new UsageError(`--arms takes ${ARMS.join(', ')}, not ${arm}`);
  for (const kind of options.kinds ?? []) if (!KINDS.includes(kind)) throw new UsageError(`--kinds takes ${KINDS.join(', ')}, not ${kind}`);
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
 * How each graph is guided (P392): the base one as every report had it, with
 * prompt cards only when the run says `--prompt-cards` (P386); the others
 * each change one thing of it.
 */
const guideArgs = (variant, options) =>
  ({
    graph: options.promptCards === true ? [] : ['--no-prompt-cards'],
    'graph-cards': [],
    'graph-terminal': ['--terminal', '--no-prompt-cards'],
    'graph-upfront': ['--no-prompt-cards'],
  })[variant];

/**
 * The project as generated, for the arms without the graph, and once for
 * each graph the run's arms ask (P392): copied, built and guided, the
 * configuration of `graph-upfront` listing four tools upfront.
 */
const prepare = (work, options, arms = DEFAULT_ARMS) => {
  const plain = join(work, 'project');
  if (!existsSync(join(plain, 'key.json'))) writeProject(plain, { seed: options.seed, resources: options.resources });
  const graphs = {};
  for (const variant of new Set(arms.map((arm) => ARM_SETUPS[arm].variant).filter(Boolean))) {
    const dir = join(work, variant);
    const configPath = join(dir, 'flowatlas.config.json');
    if (!existsSync(join(dir, '.flowatlas', 'graph.db'))) {
      rmSync(dir, { recursive: true, force: true });
      cpSync(plain, dir, { recursive: true });
      if (variant === 'graph-upfront') {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        writeFileSync(configPath, `${JSON.stringify({ ...config, mcp: { upfront: UPFRONT_FOUR } }, null, 2)}\n`);
      }
      flowatlas(['build', '--config', configPath], dir);
    }
    // Every time, so a graph prepared for a run with prompt cards does not keep them for one without (P386).
    flowatlas(['agents', 'install', '--config', configPath, '--instructions', '--hook', ...guideArgs(variant, options)], dir);
    graphs[variant] = dir;
  }
  // The terminal arm's `flowatlas`: the command, run where its graph is, found first on the session's PATH.
  let terminalBin;
  if (graphs['graph-terminal'] !== undefined) {
    terminalBin = join(work, 'terminal-bin');
    mkdirSync(terminalBin, { recursive: true });
    const shim = join(terminalBin, 'flowatlas');
    writeFileSync(shim, `#!/bin/sh\ncd ${JSON.stringify(graphs['graph-terminal'])} && exec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`);
    chmodSync(shim, 0o755);
  }
  const key = JSON.parse(readFileSync(join(plain, 'key.json'), 'utf8'));
  return { plain, graph: graphs.graph, graphs, terminalBin, key };
};

/** A fresh copy of what one arm sees, and the MCP configuration it is handed. */
const workspaceFor = (prepared, question, arm, at) => {
  rmSync(at, { recursive: true, force: true });
  const setup = ARM_SETUPS[arm];
  const withGraph = setup.graph !== 'none';
  const whole = setup.whole;
  const from = withGraph ? prepared.graphs[setup.variant] : prepared.plain;
  const source = whole ? from : join(from, question.from);
  cpSync(source, at, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      if (GRAPH_ONLY.has(name) && dirname(path) === from) return false;
      return withGraph || !GUIDE.has(name);
    },
  });
  if (withGraph && whole) {
    // The guide at the top of the workspace too, where the session starts: the gateway's is every repository's.
    for (const name of ['CLAUDE.md', '.claude']) {
      const guide = join(from, 'gateway', name);
      if (existsSync(guide)) cpSync(guide, join(at, name), { recursive: true });
    }
  }
  const server =
    setup.graph === 'mcp'
      ? {
          flowatlas: {
            command: process.execPath,
            args: [CLI, 'mcp', ...(whole ? ['--config', join(from, 'flowatlas.config.json')] : ['--db', join(from, '.flowatlas', 'graph.db')])],
            env: { FLOWATLAS_LOG_QUESTIONS: '1' },
          },
        }
      : {};
  const mcpConfig = `${at}.mcp-config.json`;
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: server }));
  return { cwd: at, mcpConfig, graph: setup.graph === 'mcp', ...(setup.graph === 'terminal' ? { terminalBin: prepared.terminalBin } : {}) };
};

/** The question log of the graph an arm asks; none for the arms without one. */
const questionLog = (prepared, arm) => {
  const variant = ARM_SETUPS[arm].variant;
  return variant === undefined ? undefined : join(prepared.graphs[variant], '.flowatlas', 'questions.jsonl');
};
const logLines = (path) => (path !== undefined && existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);

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
  const pilots = readRuns(results).filter(
    ({ run: other }) =>
      other.kind === 'pilot' &&
      other.flowatlas.commit === run.flowatlas.commit &&
      other.modelRequested === run.modelRequested &&
      other.seed === run.seed &&
      (other.promptCards === true) === (run.promptCards === true) &&
      // Every arm the full run asks, estimated from the pilot's own sessions of it (P392).
      run.arms.every((arm) => (other.arms ?? DEFAULT_ARMS).includes(arm)) &&
      other.done === true,
  );
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
    const before = logLines(questionLog(prepared, step.arm)).length;
    const result = await claude.runSession({
      cwd: space.cwd,
      prompt: step.question.prompt,
      model: run.modelRequested,
      mcpConfig: space.mcpConfig,
      graph: space.graph,
      ...(space.terminalBin === undefined ? {} : { terminalBin: space.terminalBin }),
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
    const asked = logLines(questionLog(prepared, step.arm)).slice(before).map((line) => JSON.parse(line));
    const tools = result.tools ?? {};
    const mcpUp = !space.graph || result.mcp.some((server) => server.name === 'flowatlas' && server.status === 'connected');
    const marked = result.outcome === 'answered' && mcpUp ? score(step.question, result.answer) : { score: 0, correct: false, by: 'unscored' };
    // Where the turns went (P392), from the transcript: a graph call is a tool of the server or, in the terminal arm, the command.
    const read = readTranscript(existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n') : []);
    const turns = classify(read, marked.given);
    const flowatlasCalls = read.calls.filter((call) => graphTool(call) !== undefined).length;
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
      ...(marked.tp === undefined ? {} : { tp: marked.tp, fp: marked.fp, decoyHits: marked.decoyHits, context: step.question.context }),
      ...(marked.given === undefined ? {} : { given: marked.given }),
      answerLine: (result.answer.match(/^\s*\**ANSWER:?\**.*$/gim) ?? []).pop()?.slice(0, 2000) ?? null,
      tools,
      toolCalls: Object.values(tools).reduce((sum, count) => sum + count, 0),
      flowatlasCalls,
      flowatlasAnswerChars: asked.reduce((sum, entry) => sum + (entry.chars ?? 0), 0),
      tokens: tokensOf(result.usage),
      turns: result.turns,
      calls: turns.calls,
      extraTurns: turns.extraTurns,
      turnKinds: turns.kinds,
      failedCalls: turns.failedCalls,
      wastedCalls: turns.wastedCalls,
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
      armSetups: Object.fromEntries(options.arms.map((arm) => [arm, ARM_SETUPS[arm]])),
      ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
      pauseSeconds: options.pauseSeconds,
      timeoutSeconds: options.timeoutSeconds,
      promptCards: options.promptCards === true,
      guide:
        options.promptCards === true
          ? 'skill + instructions + search hook + prompt cards (flowatlas agents install --instructions --hook)'
          : 'skill + instructions + search hook (flowatlas agents install --instructions --hook --no-prompt-cards)',
      ...(options.arms.some((arm) => ['E', 'F', 'G'].includes(arm))
        ? {
            guides: {
              E: 'the terminal guide and hooks, no server (flowatlas agents install --instructions --hook --terminal --no-prompt-cards)',
              F: 'D with prompt cards (flowatlas agents install --instructions --hook)',
              G: `D with mcp.upfront ${UPFRONT_FOUR.join(', ')}`,
            },
          }
        : {}),
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
  const prepared = prepare(workDir, run, run.arms);
  // `--kinds` (P392): only the questions of those kinds, the pilot's too.
  const all = questionsFor(prepared.key).filter((question) => run.kinds === undefined || run.kinds.includes(question.kind));
  const pilotQuestions = all.filter((question) => question.pilot);
  // A pilot of kinds no pilot question has asks the first question of each instead.
  const questions = run.kind === 'pilot' ? (pilotQuestions.length > 0 ? pilotQuestions : all.filter((question, index) => all.findIndex((other) => other.kind === question.kind) === index)) : all;
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
