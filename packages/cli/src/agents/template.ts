import { createHash } from 'node:crypto';
import { AGENT_HABITS, AGENT_QUESTIONS, AGENT_RULES, AGENT_TERMINAL_HABITS, AGENT_TERMINAL_RULES } from '@flowatlas/core';
import { CORE_TOOLS } from '@flowatlas/mcp';

export { CORE_TOOLS };

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
  /**
   * Whether the graph server lists its core tools to load upfront there
   * (P380): unless the configuration's `mcp.alwaysLoad` or the `.mcp.json`
   * entry (`"alwaysLoad": false`, `--no-always-load`) turns it off.
   */
  alwaysLoad?: boolean;
  /**
   * The core tools the server loads upfront there, where fewer than all of
   * them (P392): the configuration's `mcp.upfront`, or `--upfront` on the
   * `.mcp.json` entry. Undefined is every core tool.
   */
  upfront?: readonly string[];
  /**
   * How the assistant asks the graph (P392): through the graph server, or in
   * a terminal with the commands and `--format json`, where no server is
   * registered (`flowatlas agents install --terminal`).
   */
  via?: 'mcp' | 'terminal';
  /**
   * Whether that repository's `.mcp.json` registers the graph server (P382):
   * Claude Code then hands every session the server's instructions, which say
   * the questions, the call for each and the habits.
   */
  registered?: boolean;
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

/** The name the graph server is registered under when a repository's `.mcp.json` says nothing else. */
export const DEFAULT_SERVER = 'flowatlas';

/**
 * The ToolSearch query that loads the core tools in one call (P366), with
 * the names Claude Code gives a server's tools: `mcp__<server>__<tool>`, the
 * server's name with anything but letters, digits, `_` and `-` made `_`.
 * Each tool loaded alone is a turn of its own. Since P380 the server lists
 * the core tools to load upfront, so the guide writes this only where they
 * do not (turned off, or a Claude Code too old to read the mark).
 */
export const toolSearchQuery = (server: string = DEFAULT_SERVER): string => {
  const prefix = `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
  return `select:${CORE_TOOLS.map((tool) => `${prefix}${tool}`).join(',')}`;
};

/** The Claude Code release that first loads a tool its server marks upfront. */
export const ALWAYS_LOAD_SINCE = 'v2.1.285';

/**
 * How to load the tools, in a line (P380): with the core tools upfront there
 * is no ToolSearch call to make for them, only one for every other tool a
 * question needs; with them deferred, the one call that loads them.
 */
const toolSearchLine = (guide: AgentGuide): string => {
  if (deferred(guide)) return `In Claude Code, load the tools in ONE ToolSearch call: \`${toolSearchQuery(guide.server)}\`.`;
  const some = fewerUpfront(guide);
  if (some !== undefined) return `In Claude Code ${namesSaid(some)} ${some.length === 1 ? 'is' : 'are'} loaded already; load any other graph tool in ONE ToolSearch call with every tool you need.`;
  return 'In Claude Code the core graph tools are loaded already, with no ToolSearch call; load any other in ONE ToolSearch call with every tool you need.';
};

/** Whether no tool loads upfront: turned off, or an upfront list that names none. */
const deferred = (guide: AgentGuide): boolean => guide.alwaysLoad === false || guide.upfront?.length === 0;

/** The core tools upfront where fewer than all of them load upfront (P392). */
const fewerUpfront = (guide: AgentGuide): readonly string[] | undefined =>
  guide.upfront !== undefined && guide.upfront.length > 0 && CORE_TOOLS.some((tool) => !guide.upfront?.includes(tool)) ? guide.upfront : undefined;

const namesSaid = (names: readonly string[]): string => (names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The same for the full guide, read when used: where the core tools are upfront, the call for a Claude Code that does not load them. */
const toolSearchSaid = (guide: AgentGuide): string =>
  deferred(guide) ? toolSearchLine(guide) : `${toolSearchLine(guide)} Before Claude Code ${ALWAYS_LOAD_SINCE}: \`${toolSearchQuery(guide.server)}\`.`;

/** How the terminal guide says to ask (P392): every command, and what `--format json` prints. */
const TERMINAL_LINE = 'Ask in a terminal, with `--format json`: each command prints the graph server\'s answer to the same question, compact, and needs no server.';

const servicesLine = (guide: AgentGuide): string =>
  `This repository (${guide.here.join(', ')}) is one of ${guide.services.length} that flowatlas joins: ${guide.services.map((service) => `${service.name} (${service.type})`).join(', ')}.`;

/** The full guide, the same in every file flowatlas owns: loaded when its description fits the question. */
export const guideBody = (guide: AgentGuide): string => {
  if (guide.via === 'terminal') return terminalBody(guide);
  const lines = [
    '# flowatlas: one map of this project',
    '',
    servicesLine(guide),
    elsewhereLine(guide),
    '',
    '## Ask the graph first for',
    '',
    '| Question | Graph server (MCP) | Terminal |',
    '|---|---|---|',
    ...AGENT_QUESTIONS.map((question) => `| ${question.ask} | \`${question.tool}\` | \`${question.command}\` |`),
    '',
    '## How',
    '',
    `- ${toolSearchSaid(guide)}`,
    ...[...AGENT_HABITS, ...AGENT_RULES].map((rule) => `- ${rule}`),
    '',
    'The graph server is registered in `.mcp.json`. Without it, every command above answers with `--format json`.',
  ];
  return `${lines.join('\n')}\n`;
};

const elsewhereLine = (guide: AgentGuide): string => {
  const elsewhere = others(guide);
  return elsewhere.length === 0
    ? 'A search here sees this checkout; the graph sees how its parts join.'
    : `A search here sees only this checkout; the graph also sees ${elsewhere.join(', ')}, and every request, message and call between them.`;
};

/**
 * The full guide for an assistant that asks in a terminal (P392): the
 * commands alone, with no server, no tool names and no ToolSearch.
 */
const terminalBody = (guide: AgentGuide): string => {
  const lines = [
    '# flowatlas: one map of this project',
    '',
    servicesLine(guide),
    elsewhereLine(guide),
    '',
    '## Ask the graph first for',
    '',
    '| Question | Terminal |',
    '|---|---|',
    ...AGENT_QUESTIONS.map((question) => `| ${question.ask} | \`${question.command}\` |`),
    '',
    '## How',
    '',
    `- ${TERMINAL_LINE}`,
    ...[...AGENT_TERMINAL_HABITS, ...AGENT_TERMINAL_RULES].map((rule) => `- ${rule}`),
  ];
  return `${lines.join('\n')}\n`;
};

/**
 * What a team's own file holds (P366): `AGENTS.md`, `CLAUDE.md` and Copilot's
 * instructions are read whole at the start of every session and sent again on
 * every turn, so the block says only when to ask the graph and how to spend
 * few turns doing it. It names no full guide to read (P382): the skill loads
 * when its description fits, and a line pointing at it invited a Read, a turn
 * of its own. Where the server's instructions are read beside it
 * (`besideInstructions`), they say the questions, the call for each and the
 * habits, and the block keeps the services and the habit for an edit.
 */
export const sharedBody = (guide: AgentGuide, target: AgentTarget = 'agents-md'): string => {
  const services = `This repository (${guide.here.join(', ')}) is one of ${guide.services.length} that the flowatlas graph joins (${guide.services.map((service) => service.name).join(', ')}).`;
  // In a terminal (P392): each question with its command, and the habits said for commands.
  if (guide.via === 'terminal') {
    const lines = [
      '## flowatlas',
      '',
      `${services} Ask it in a terminal, not a search here, with \`--format json\`:`,
      '',
      ...AGENT_QUESTIONS.map((question) => `- ${question.short}: \`${question.command}\``),
      ...AGENT_TERMINAL_HABITS.map((habit) => `- ${habit}`),
    ];
    return `${lines.join('\n')}\n`;
  }
  const lines = besideInstructions(guide, target)
    ? [
        '## flowatlas',
        '',
        `${services} Ask its server (\`.mcp.json\`), not a search of this checkout: its instructions name the one call for each question.`,
        '',
        `- ${AGENT_HABITS[0]}`,
        ...(guide.alwaysLoad === false ? [`- ${toolSearchLine(guide)}`] : []),
      ]
    : [
        '## flowatlas',
        '',
        `${services} Ask it, not a search here: ${AGENT_QUESTIONS.map((question) => question.short).join(', ')}.`,
        '',
        `- ${toolSearchLine(guide)}`,
        ...AGENT_HABITS.map((habit) => `- ${habit}`),
      ];
  return `${lines.join('\n')}\n`;
};

/**
 * Whether a team's file is read beside the graph server's instructions
 * (P382): `CLAUDE.md` is Claude Code's, and where the repository's
 * `.mcp.json` registers the server Claude Code hands every session its
 * instructions too. `AGENTS.md` and Copilot's file are read by assistants
 * that may never start the server, so they keep the questions and habits.
 */
export function besideInstructions(guide: AgentGuide, target: AgentTarget): boolean {
  return target === 'claude-md' && guide.registered === true && guide.via !== 'terminal';
}

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
export const sharedBlock = (guide: AgentGuide, target: AgentTarget = 'agents-md'): string => `${BLOCK_OPEN}\n${sharedBody(guide, target)}${BLOCK_CLOSE}`;

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
