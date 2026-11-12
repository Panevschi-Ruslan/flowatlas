#!/usr/bin/env node
/**
 * The benchmark without an assistant (P238), in `pnpm check`.
 *
 *   node scripts/bench-agent/dry.mjs            # check
 *   node scripts/bench-agent/dry.mjs --record   # write recorded/dry.json again
 *
 * It generates a small project, makes every question concrete against its
 * key, and marks the answers in `recorded/dry.json` - right ones, partly right
 * ones, wrong ones, one with no `ANSWER:` line and one with nothing to read -
 * which must come out exactly as recorded. A change to the generator, the key,
 * the questions or the scorers that moves any of them fails here, before it
 * is paid for in a run.
 *
 * Then it builds the graph of that project and holds it to the key: every
 * call the key has must be in the graph, except the ones the traps are there
 * to hide, and every handler of every event. This is not a measurement - the
 * benchmark's figures come from the assistant's answers - it is the check
 * that the arms with the graph are measuring a graph that reads the project.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProject } from './generate.mjs';
import { routeKey } from './model.mjs';
import { questionsFor } from './questions.mjs';
import { score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
export const RECORDED = join(HERE, 'recorded', 'dry.json');
const DRY = { seed: 5, resources: 3 };

/** The answers the dry run marks, made once from the key: each question right, and most of them wrong in a way of their own. */
const answersFor = (questions) =>
  questions.flatMap((question) => {
    const right =
      question.scorer === 'yesno' || question.scorer === 'exact'
        ? `It is in the code.\nANSWER: ${JSON.stringify(question.expected)}`
        : `Found them.\nANSWER: ${JSON.stringify(question.expected)}`;
    const wrong =
      question.scorer === 'yesno'
        ? `ANSWER: "${question.expected === 'yes' ? 'no' : 'yes'}"`
        : question.scorer === 'exact'
          ? 'ANSWER: "unknown"'
          : `ANSWER: ${JSON.stringify(question.expected.length === 0 ? ['Nothing.handles'] : question.expected.slice(0, Math.ceil(question.expected.length / 2)))}`;
    const free = question.scorer === 'yesno' ? `${question.expected === 'yes' ? 'Yes' : 'No'}, from what the code shows.` : undefined;
    return [
      { question: question.id, text: right },
      { question: question.id, text: wrong },
      ...(free === undefined ? [] : [{ question: question.id, text: free }]),
    ];
  });

const flowatlas = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

/** The graph against the key: the calls and handlers the key has that the graph does not. */
export const agreement = (dir, key) => {
  const graph = JSON.parse(readFileSync(join(dir, '.flowatlas', 'project-graph.json'), 'utf8'));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const linked = new Set();
  for (const edge of graph.edges) {
    if (edge.type !== 'http_calls' && edge.type !== 'hits') continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to?.meta?.method === undefined) continue;
    linked.add(`${from.repo}->${to.repo}:${routeKey(to.meta.method, to.meta.path)}`);
  }
  const consumed = new Set();
  for (const edge of graph.edges) {
    if (edge.type !== 'consumes') continue;
    const [from, to] = [nodes.get(edge.from), nodes.get(edge.to)];
    const channel = from?.type === 'channel' ? from : to?.type === 'channel' ? to : undefined;
    const handler = channel === from ? to : from;
    if (channel !== undefined) consumed.add(`${channel.label}|${handler?.repo}`);
  }
  const trapped = new Set([key.traps.helper, key.traps.settings]);
  const calls = key.calls.filter((call) => !(call.from.service === 'gateway' && trapped.has(call.from.file)));
  const missedCalls = calls.filter((call) => !linked.has(`${call.from.service}->${call.to}`));
  const handlers = key.events.flatMap((event) => event.consumers.map((consumer) => ({ event: event.name, service: consumer.service })));
  const missedHandlers = handlers.filter((handler) => !consumed.has(`${handler.event}|${handler.service}`));
  return { calls: calls.length, missedCalls, trapCalls: key.calls.length - calls.length, handlers: handlers.length, missedHandlers };
};

export const runDry = async ({ record = false } = {}) => {
  const lines = [];
  let ok = true;
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-bench-dry-'));
  try {
    const project = writeProject(dir, DRY);
    const questions = questionsFor(project.key);
    lines.push(`dry: seed ${DRY.seed}, ${DRY.resources} resources a service: ${project.files} files, ${project.lines} lines, ${questions.length} questions`);
    const byId = new Map(questions.map((question) => [question.id, question]));
    if (record) {
      const answers = answersFor(questions).map((answer) => {
        const marked = score(byId.get(answer.question), answer.text);
        return { ...answer, expect: { score: marked.score, correct: marked.correct, by: marked.by } };
      });
      // One answer with no ANSWER line and nothing to read, and one read by its patterns alone.
      const first = questions.find((question) => question.scorer === 'routes');
      answers.push({ question: first.id, text: 'I could not tell from here.', expect: { score: 0, correct: false, by: 'unscored' } });
      answers.push({ question: first.id, text: `The ones nothing calls: ${first.expected.join(', ')}.`, expect: { ...pick(score(first, `The ones nothing calls: ${first.expected.join(', ')}.`)) } });
      writeFileSync(RECORDED, `${JSON.stringify({ ...DRY, keyRoutes: project.key.routes.length, answers }, null, 2)}\n`);
      lines.push(`recorded ${answers.length} answers in ${RECORDED}`);
    }
    const recorded = JSON.parse(readFileSync(RECORDED, 'utf8'));
    let marked = 0;
    for (const answer of recorded.answers) {
      const question = byId.get(answer.question);
      if (question === undefined) {
        ok = false;
        lines.push(`  ${answer.question}: no such question any more; run dry.mjs --record`);
        continue;
      }
      const got = pick(score(question, answer.text));
      if (JSON.stringify(got) !== JSON.stringify(answer.expect)) {
        ok = false;
        lines.push(`  ${answer.question}: marked ${JSON.stringify(got)}, recorded ${JSON.stringify(answer.expect)} for ${JSON.stringify(answer.text.slice(0, 80))}`);
      } else {
        marked += 1;
      }
    }
    lines.push(`recorded answers: ${marked} of ${recorded.answers.length} marked as recorded`);
    const built = flowatlas(['build', '--config', join(dir, 'flowatlas.config.json')], dir);
    if (built.status !== 0) {
      ok = false;
      lines.push(`flowatlas build failed (${built.status}): ${(built.stderr || built.stdout).slice(-600)}`);
    } else {
      const agreed = agreement(dir, project.key);
      lines.push(
        `the graph against the key: ${agreed.calls - agreed.missedCalls.length} of ${agreed.calls} calls (and the ${agreed.trapCalls} the traps hide are not counted), ${agreed.handlers - agreed.missedHandlers.length} of ${agreed.handlers} event handlers`,
      );
      for (const call of agreed.missedCalls.slice(0, 10)) lines.push(`  missing call ${call.from.service} ${call.from.symbol} -> ${call.to}`);
      for (const handler of agreed.missedHandlers.slice(0, 10)) lines.push(`  missing handler of ${handler.event} in ${handler.service}`);
      if (agreed.missedCalls.length > 0 || agreed.missedHandlers.length > 0) ok = false;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok, lines };
};

const pick = (marked) => ({ score: marked.score, correct: marked.correct, by: marked.by });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runDry({ record: process.argv.includes('--record') });
  process.stdout.write(`${result.lines.join('\n')}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
