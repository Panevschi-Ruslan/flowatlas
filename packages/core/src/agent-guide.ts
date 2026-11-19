/**
 * When an assistant should ask the graph rather than search the files (P227).
 *
 * Registering the graph server tells an assistant that it exists and nothing
 * about when to choose it, so an assistant in one checkout greps that checkout
 * and answers a cross-repository question from half the project. This is the
 * one list of the questions the graph answers better than a search, with the
 * tool that answers each and the command for an assistant without the server.
 * The files `flowatlas agents install` writes, the server's instructions and
 * the search hook all render it, so they never disagree (the P97 rule).
 *
 * It names tools and commands only: nothing here changes with a build, so a
 * committed file rendered from it is never out of date (D5).
 */

export interface AgentQuestion {
  /** The question, as an assistant would meet it. */
  ask: string;
  /** The graph server's call that answers it. */
  tool: string;
  /** The same from a terminal, for an assistant without the server. */
  command: string;
}

export const AGENT_QUESTIONS: readonly AgentQuestion[] = Object.freeze([
  { ask: 'who calls this route, method or handler, in any repository', tool: 'who_calls({symbol})', command: 'flowatlas impact <symbol>' },
  { ask: 'what breaks if I change this, and whose', tool: 'impact({symbol})', command: 'flowatlas impact <symbol> --entries-only' },
  { ask: 'follow a request end to end, across services', tool: 'get_flow({entry})', command: 'flowatlas flow "<VERB /path>"' },
  { ask: 'who publishes or handles this message', tool: 'who_emits / who_consumes({channel})', command: 'flowatlas channel <name>' },
  { ask: 'how does this reach that', tool: 'get_flow({entry, to})', command: 'flowatlas path <from> <to>' },
  { ask: 'everything about one name, to hand on', tool: 'describe_for_prompt({id})', command: 'flowatlas explain <name>' },
  { ask: 'is this dead', tool: 'dead({id})', command: 'flowatlas dead' },
  { ask: 'why does a flow stop', tool: 'cant_follow', command: 'flowatlas doctor --unresolved' },
  { ask: 'is this branch safe to merge', tool: 'what_changed({verdict: true})', command: 'flowatlas diff <base>' },
]);

/** The rules every rendering states, after the questions. */
export const AGENT_RULES: readonly string[] = Object.freeze([
  'Narrow, then read: find the exact id (find_symbol, list_entries or search), ask what it connects to, then read the source of the one or two steps that matter.',
  'An answer says what the graph could not read (`unresolvedOnPath`, `cant_follow`): search those files yourself; the graph is not the whole truth there.',
  'An answer with `stale` was built before the files it cites changed: run `flowatlas build` and ask again.',
  'A search inside one repository cannot see the others; the graph joins them.',
]);

/** The questions as one line, for the graph server's instructions. */
export const agentQuestionsLine = (): string =>
  `Ask it, not a search of the files, for: ${AGENT_QUESTIONS.map((question) => `${question.ask} (${question.tool})`).join('; ')}.`;
