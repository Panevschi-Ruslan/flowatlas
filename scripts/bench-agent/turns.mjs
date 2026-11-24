#!/usr/bin/env node
/**
 * Where a session's turns went (P392): every turn beyond the call that
 * answers and the answer itself, classified from the session's transcript.
 *
 *   node scripts/bench-agent/turns.mjs <results dir>                      # the table, from sessions.jsonl
 *   node scripts/bench-agent/turns.mjs <results dir> --transcripts <dir>  # classify the transcripts again
 *
 * A turn costs the whole context again, so a turn spent loading tools or
 * re-checking a complete answer costs more than any answer. Each call of a
 * session is put in one class:
 *
 * - `tool-search`: a ToolSearch call, loading tool schemas;
 * - `skill`: the Skill tool, or a Read of a `SKILL.md`;
 * - `start-here`: the graph's `start_here`;
 * - `failed-call`: a call answered as an error, a list of candidates or
 *   nothing matching (`failedAs`: `error`, `candidates`, `nothing-matches`;
 *   an error naming an input is `input`);
 * - `lookup-first`: a `find_symbol` before the question's own graph call;
 * - `question-call`: the first graph call that answered;
 * - `second-graph-call`: every graph call after it (`fetched`: the tool and
 *   the input it named);
 * - `read-after-complete`: a Read, Grep, Glob or shell command after a graph
 *   answer said `complete: true` (`lookedFor`: its pattern or file);
 * - `read`: any other Read, Grep, Glob or shell command, the work of the arms
 *   without the graph;
 * - `other`.
 *
 * A graph call is a `mcp__flowatlas__*` tool, or in the terminal arm a shell
 * command that runs `flowatlas`. Beside the classes: the tool error rate
 * (failed calls over calls), and wasted calls - calls whose answer holds
 * none of the items the final answer names, judged only where the answer
 * names items (a yes, a no or a value is not judged).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_PREFIX = 'mcp__flowatlas__';
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'Bash']);
export const CLASSES = ['tool-search', 'skill', 'start-here', 'failed-call', 'lookup-first', 'question-call', 'second-graph-call', 'read-after-complete', 'read', 'other'];

/** The text of a tool result, however the content was given. */
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('\n');
  return '';
};

/** A shell command that runs flowatlas, as the terminal arm asks the graph: its subcommand. */
const terminalTool = (command) => {
  const match = /(?:^|[;&|]\s*|\s)(?:\S*\/)?flowatlas(?:\.js)?\s+([a-z][\w-]*)/.exec(String(command ?? ''));
  return match === null ? undefined : `flowatlas ${match[1]}`;
};

/** Which graph tool a call is, or undefined for a call that does not ask the graph. */
export const graphTool = (call) => {
  if (call.name.startsWith(GRAPH_PREFIX)) return call.name.slice(GRAPH_PREFIX.length);
  if (call.name === 'Bash') return terminalTool(call.input?.command);
  return undefined;
};

/** How a graph answer failed, or undefined for one that answered. */
const failedAs = (result) => {
  if (result === undefined) return undefined;
  const text = result.text;
  if (result.isError) return /\b(?:input|argument|parameter|expected|required|invalid)\b/i.test(text) ? 'input' : /\bnothing (?:matches|is named)|\bno (?:node|symbol|route|channel|entry)\b/i.test(text) ? 'nothing-matches' : 'error';
  if (/"candidates"\s*:/.test(text)) return 'candidates';
  if (/\bnothing (?:matches|is named)\b|"matches"\s*:\s*\[\s*\]/i.test(text)) return 'nothing-matches';
  return undefined;
};

/** What a call named: the input a second graph call fetched, the pattern or file a read looked for. */
const namedBy = (call) => {
  const input = call.input ?? {};
  for (const key of ['symbol', 'symbols', 'id', 'ids', 'entry', 'route', 'channel', 'query', 'queries', 'edge', 'type', 'pattern', 'file_path', 'path', 'command']) {
    if (input[key] !== undefined) return `${key}: ${JSON.stringify(input[key]).slice(0, 120)}`;
  }
  return '';
};

/**
 * A transcript read into its calls, in order, each with its result, and its
 * turns: the assistant messages that called a tool.
 */
export const readTranscript = (lines) => {
  const calls = [];
  const byId = new Map();
  const turns = new Set();
  let answer = '';
  let numTurns;
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant') {
      const parts = (event.message?.content ?? []).filter((part) => part.type === 'tool_use');
      if (parts.length === 0) continue;
      const turn = event.message?.id ?? `turn-${turns.size}`;
      turns.add(turn);
      for (const part of parts) {
        const call = { id: part.id, name: part.name, input: part.input ?? {}, turn };
        calls.push(call);
        if (part.id !== undefined) byId.set(part.id, call);
      }
    } else if (event.type === 'user') {
      for (const part of event.message?.content ?? []) {
        if (part.type !== 'tool_result') continue;
        const call = byId.get(part.tool_use_id);
        if (call !== undefined) call.result = { text: textOf(part.content), isError: part.is_error === true };
      }
    } else if (event.type === 'result') {
      answer = typeof event.result === 'string' ? event.result : '';
      numTurns = event.num_turns;
    }
  }
  return { calls, toolTurns: turns.size, answer, numTurns };
};

/** What an answer's items look like inside a tool's answer: a symbol, a route's literal path, a file's name, a name. */
const probesOf = (items) =>
  items.flatMap((item) => {
    const text = String(item);
    const route = /^(?:GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/.exec(text);
    if (route !== null) return [route[1].split(':')[0].replace(/\/$/, '') || route[1]];
    if (/\.(?:tsx?|tf|ya?ml)$/.test(text)) return [text.split('/').pop()];
    return [text];
  });

/**
 * Every call of a transcript classified, and the session's measures: the
 * calls in each class, the turns beyond call and answer, failed and wasted
 * calls. `items` are what the final answer named (the scorer's reading of
 * it), for wasted calls; without them waste is not judged.
 */
export const classify = (transcript, items) => {
  const kinds = Object.fromEntries(CLASSES.map((name) => [name, 0]));
  const detail = [];
  let answered = false;
  let complete = false;
  const graphCalls = transcript.calls.filter((call) => graphTool(call) !== undefined);
  for (const call of transcript.calls) {
    const tool = graphTool(call);
    let kind;
    let note = '';
    if (call.name === 'ToolSearch') kind = 'tool-search';
    else if (call.name === 'Skill' || (call.name === 'Read' && /SKILL\.md$/.test(String(call.input.file_path ?? '')))) kind = 'skill';
    else if (tool === 'start_here') kind = 'start-here';
    else if (tool !== undefined) {
      const failed = failedAs(call.result);
      if (failed !== undefined) {
        kind = 'failed-call';
        note = failed;
      } else if (!answered && tool === 'find_symbol' && graphCalls.some((other) => other !== call && graphTool(other) !== 'find_symbol' && transcript.calls.indexOf(other) > transcript.calls.indexOf(call))) {
        kind = 'lookup-first';
      } else if (!answered) {
        kind = 'question-call';
        answered = true;
      } else {
        kind = 'second-graph-call';
        note = `${tool} ${namedBy(call)}`.trim();
      }
      if (/"complete"\s*:\s*true/.test(call.result?.text ?? '')) complete = true;
    } else if (READS.has(call.name)) {
      kind = complete ? 'read-after-complete' : 'read';
      if (complete) note = namedBy(call);
    } else kind = 'other';
    kinds[kind] += 1;
    detail.push({ tool: tool ?? call.name, kind, ...(note === '' ? {} : { note }) });
  }
  const failed = kinds['failed-call'];
  const probes = items === undefined || items.length === 0 ? undefined : probesOf(items);
  // Loading tools or the guide is overhead, counted in its class, not judged as waste.
  const judged = transcript.calls.filter((call, index) => call.result !== undefined && !['tool-search', 'skill'].includes(detail[index].kind));
  const wasted = probes === undefined ? null : judged.filter((call) => !probes.some((probe) => call.result.text.includes(probe))).length;
  return {
    kinds,
    detail,
    calls: transcript.calls.length,
    toolTurns: transcript.toolTurns,
    // Beyond the one turn that calls and the one that answers.
    extraTurns: Math.max(0, transcript.toolTurns - 1),
    failedCalls: failed,
    wastedCalls: wasted,
  };
};

/** The table of one run: per arm and kind, the mean of each class a session, and the rates. */
export const turnTable = (sessions) => {
  const rows = [];
  const groups = new Map();
  for (const session of sessions) {
    if (session.turnKinds === undefined) continue;
    const key = `${session.arm}|${session.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  for (const [key, mine] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [arm, kind] = key.split('|');
    const mean = (pick) => Math.round((mine.reduce((sum, session) => sum + pick(session), 0) / mine.length) * 10) / 10;
    const calls = mine.reduce((sum, session) => sum + (session.calls ?? 0), 0);
    const failed = mine.reduce((sum, session) => sum + (session.failedCalls ?? 0), 0);
    const judged = mine.filter((session) => typeof session.wastedCalls === 'number');
    rows.push({
      arm,
      kind,
      sessions: mine.length,
      extraTurns: mean((session) => session.extraTurns ?? 0),
      kinds: Object.fromEntries(CLASSES.map((name) => [name, mean((session) => session.turnKinds[name] ?? 0)])),
      errorRate: calls === 0 ? 0 : Math.round((failed / calls) * 1000) / 1000,
      wasted: judged.length === 0 ? null : Math.round((judged.reduce((sum, session) => sum + session.wastedCalls, 0) / judged.length) * 10) / 10,
    });
  }
  return rows;
};

/** The table as Markdown: one row per arm and kind, a column per class (mean calls a session). */
export const renderTurns = (rows) => {
  const shown = CLASSES.filter((name) => rows.some((row) => row.kinds[name] > 0));
  const lines = [
    `| Arm | Kind | Sessions | Extra turns | ${shown.join(' | ')} | Tool errors | Wasted calls |`,
    `|---|---|---|---|${shown.map(() => '---').join('|')}|---|---|`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.arm} | ${row.kind} | ${row.sessions} | ${row.extraTurns} | ${shown.map((name) => row.kinds[name]).join(' | ')} | ${(row.errorRate * 100).toFixed(1)}% | ${row.wasted ?? '—'} |`);
  }
  return `${lines.join('\n')}\n`;
};

/** Sessions with their turns classified again from transcripts in `dir`, named `<question>-<arm>-<rep>.jsonl`. */
export const reclassify = (sessions, dir) =>
  sessions.map((session) => {
    const path = join(dir, `${session.question}-${session.arm}-${session.rep}.jsonl`);
    if (!existsSync(path)) return session;
    const read = readTranscript(readFileSync(path, 'utf8').split('\n'));
    const measured = classify(read, session.given);
    return { ...session, turnKinds: measured.kinds, extraTurns: measured.extraTurns, calls: measured.calls, failedCalls: measured.failedCalls, wastedCalls: measured.wastedCalls };
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--transcripts');
  const dir = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--transcripts');
  if (dir === undefined || !existsSync(join(resolve(dir), 'sessions.jsonl'))) {
    process.stderr.write('usage: turns.mjs <results dir> [--transcripts <dir of transcripts>]\n');
    process.exit(2);
  }
  let sessions = readFileSync(join(resolve(dir), 'sessions.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (at !== -1) {
    const from = resolve(argv[at + 1]);
    sessions = reclassify(sessions, from);
    process.stdout.write(`classified from ${readdirSync(from).filter((name) => name.endsWith('.jsonl')).length} transcripts in ${basename(from)}\n`);
  }
  const rows = turnTable(sessions);
  process.stdout.write(rows.length === 0 ? 'no session of this run has its turns classified; pass --transcripts <dir>\n' : renderTurns(rows));
}
