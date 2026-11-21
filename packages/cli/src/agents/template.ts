import { createHash } from 'node:crypto';
import { AGENT_HABITS, AGENT_QUESTIONS, AGENT_RULES } from '@flowatlas/core';

/**
 * What `flowatlas agents install` writes for each assistant (P227).
 *
 * One model (`agentGuide`) and a renderer per place an assistant reads its
 * instructions from, so every assistant is told the same thing, and the graph
 * server's instructions say it too (core's `AGENT_QUESTIONS`, D7). Nothing in
 * it changes with a build: the services change only with the configuration,
 * and counts, gaps and freshness come from `start_here` when asked (D5).
 */
export interface GuideService {
  name: string;
  type: string;
}

export interface AgentGuide {
  /** The services of the project, as the configuration lists them. */
  services: readonly GuideService[];
  /** The services whose repository this file is written into. */
  here: readonly string[];
  /** The name the graph server is registered under in that repository's `.mcp.json`; `flowatlas` when it says none. */
  server?: string;
}

/** Where an assistant reads instructions from, and whether the file is flowatlas's own. */
export type AgentTarget = 'claude-skill' | 'cursor-rule' | 'agents-md' | 'claude-md' | 'copilot';

/** Files flowatlas owns and writes whole: new files, written by default (D1). */
export const OWNED_TARGETS: readonly AgentTarget[] = ['claude-skill', 'cursor-rule'];

/** Files a team owns: a marked block in them, only with `--instructions` (D1). */
export const SHARED_TARGETS: readonly AgentTarget[] = ['agents-md', 'claude-md', 'copilot'];

export const TARGET_PATH: Record<AgentTarget, string> = {
  'claude-skill': '.claude/skills/flowatlas/SKILL.md',
  'cursor-rule': '.cursor/rules/flowatlas.mdc',
  'agents-md': 'AGENTS.md',
  'claude-md': 'CLAUDE.md',
  copilot: '.github/copilot-instructions.md',
};

/** The most lines the guide's body may run to: it is read at the start of a session. */
export const GUIDE_MAX_LINES = 60;

/** The most characters the block in a team's file may run to (P366): it is sent again on every turn. */
export const SHARED_MAX_CHARS = 1200;

export const BLOCK_OPEN = '<!-- flowatlas:agents -->';
export const BLOCK_CLOSE = '<!-- /flowatlas:agents -->';

/** The line an owned file carries, with the hash of what was written, so a hand edit is told apart. */
const ownedMark = (hash: string): string => `<!-- flowatlas:agents hash=${hash} -->`;
export const OWNED_MARK = /<!-- flowatlas:agents hash=([0-9a-f]{12}) -->\n/;

export const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

const others = (guide: AgentGuide): string[] => guide.services.map((service) => service.name).filter((name) => !guide.here.includes(name));

/** The description an assistant reads to decide whether to load the guide: the questions, and why a search is not enough. */
export const guideDescription = (guide: AgentGuide): string =>
  `Use for questions that cross this project's repositories (${guide.services.map((service) => service.name).join(', ')}): who calls this, what breaks if it changes, who handles a message, how a request flows, is it dead. A search of one checkout cannot see the others; the flowatlas graph joins them.`;

/** The tools a session loads at once (P366): the ones nearly every question takes. */
export const CORE_TOOLS: readonly string[] = ['search', 'who_calls', 'who_consumes', 'who_emits', 'dead', 'impact', 'find_symbol', 'list_entries', 'get_flow'];

/** The name the graph server is registered under when a repository's `.mcp.json` says nothing else. */
export const DEFAULT_SERVER = 'flowatlas';

/**
 * The ToolSearch query that loads the core tools in one call (P366), with
 * the names Claude Code gives a server's tools: `mcp__<server>__<tool>`, the
 * server's name with anything but letters, digits, `_` and `-` made `_`.
 * Each tool loaded alone is a turn of its own.
 */
export const toolSearchQuery = (server: string = DEFAULT_SERVER): string => {
  const prefix = `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
  return `select:${CORE_TOOLS.map((tool) => `${prefix}${tool}`).join(',')}`;
};

const toolSearchLine = (guide: AgentGuide): string =>
  `In Claude Code, load the tools in ONE ToolSearch call: \`${toolSearchQuery(guide.server)}\`.`;

const servicesLine = (guide: AgentGuide): string =>
  `This repository (${guide.here.join(', ')}) is one of ${guide.services.length} that flowatlas joins: ${guide.services.map((service) => `${service.name} (${service.type})`).join(', ')}.`;

/** The full guide, the same in every file flowatlas owns: loaded when its description fits the question. */
export const guideBody = (guide: AgentGuide): string => {
  const elsewhere = others(guide);
  const lines = [
    '# flowatlas: one map of this project',
    '',
    servicesLine(guide),
    elsewhere.length === 0
      ? 'A search here sees this checkout; the graph sees how its parts join.'
      : `A search here sees only this checkout; the graph also sees ${elsewhere.join(', ')}, and every request, message and call between them.`,
    '',
    '## Ask the graph first for',
    '',
    '| Question | Graph server (MCP) | Terminal |',
    '|---|---|---|',
    ...AGENT_QUESTIONS.map((question) => `| ${question.ask} | \`${question.tool}\` | \`${question.command}\` |`),
    '',
    '## How',
    '',
    `- ${toolSearchLine(guide)} Begin with \`start_here\` when you do not know where to start.`,
    ...[...AGENT_HABITS, ...AGENT_RULES].map((rule) => `- ${rule}`),
    '',
    'The graph server is registered in `.mcp.json`. Without it, every command above answers with `--format json`.',
  ];
  return `${lines.join('\n')}\n`;
};

/**
 * What a team's own file holds (P366): `AGENTS.md`, `CLAUDE.md` and Copilot's
 * instructions are read whole at the start of every session and sent again on
 * every turn, so the block says only when to ask the graph and how to spend
 * few turns doing it, and points at the full guide, which is read when used.
 */
export const sharedBody = (guide: AgentGuide): string => {
  const lines = [
    '## flowatlas',
    '',
    `This repository (${guide.here.join(', ')}) is one of ${guide.services.length} that the flowatlas graph joins (${guide.services.map((service) => service.name).join(', ')}). Ask the graph, not a search of this checkout: ${AGENT_QUESTIONS.map((question) => question.short).join(', ')}. The full guide is \`${TARGET_PATH['claude-skill']}\`.`,
    '',
    `- ${toolSearchLine(guide)}`,
    ...AGENT_HABITS.map((habit) => `- ${habit}`),
  ];
  return `${lines.join('\n')}\n`;
};

/** A file's whole text for an owned target, its mark first after any frontmatter. */
export const ownedFile = (target: AgentTarget, guide: AgentGuide): string => {
  const body = guideBody(guide);
  const mark = ownedMark(hashOf(body));
  const description = guideDescription(guide);
  if (target === 'claude-skill') return `---\nname: flowatlas\ndescription: ${JSON.stringify(description)}\n---\n${mark}\n${body}`;
  if (target === 'cursor-rule') return `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n${mark}\n${body}`;
  throw new Error(`${target} is not a file flowatlas owns`);
};

/** The marked block a shared file holds. */
export const sharedBlock = (guide: AgentGuide): string => `${BLOCK_OPEN}\n${sharedBody(guide)}${BLOCK_CLOSE}`;

const BLOCK = /\n?<!-- flowatlas:agents -->\n[\s\S]*?<!-- \/flowatlas:agents -->\n?/;

/** A shared file's text with the block put in, in place of an earlier one, or at its end. */
export const withGuideBlock = (existing: string | undefined, block: string): string => {
  if (existing === undefined || existing.trim() === '') return `${block}\n`;
  if (BLOCK.test(existing)) return existing.replace(BLOCK, (found) => `${found.startsWith('\n') ? '\n' : ''}${block}\n`);
  return `${existing.replace(/\n*$/, '\n')}\n${block}\n`;
};

/** A shared file's text with the block taken out, as it was before; undefined when nothing else is left. */
export const withoutGuideBlock = (existing: string): string | undefined => {
  const left = existing.replace(/\n\n<!-- flowatlas:agents -->\n[\s\S]*?<!-- \/flowatlas:agents -->\n?/, '\n').replace(BLOCK, '');
  return left.trim() === '' ? undefined : left;
};

export const hasGuideBlock = (text: string): boolean => BLOCK.test(text);

/** Whether an owned file is still as flowatlas wrote it: its body hashes to its mark. */
export const ownedState = (text: string): 'ours' | 'edited' | 'foreign' => {
  const mark = OWNED_MARK.exec(text);
  if (mark === null) return 'foreign';
  const body = text.slice(mark.index + mark[0].length);
  return hashOf(body) === mark[1] ? 'ours' : 'edited';
};
