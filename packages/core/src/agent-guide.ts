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
  /** The same in a few words, for text re-sent on every turn (P366). */
  short: string;
  /** The graph server's call that answers it. */
  tool: string;
  /** The same from a terminal, for an assistant without the server. */
  command: string;
}

export const AGENT_QUESTIONS: readonly AgentQuestion[] = Object.freeze([
  { ask: 'who calls this route, method or handler, in any repository', short: 'who calls this', tool: 'who_calls({symbol})', command: 'flowatlas impact <symbol>' },
  { ask: 'what breaks if I change this, and whose', short: 'what breaks if it changes', tool: 'impact({symbol})', command: 'flowatlas impact <symbol> --entries-only' },
  { ask: 'follow a request end to end, across services', short: 'how a request flows', tool: 'get_flow({entry})', command: 'flowatlas flow "<VERB /path>"' },
  { ask: 'who publishes or handles this message', short: 'who publishes or handles a message', tool: 'who_emits / who_consumes({channel})', command: 'flowatlas channel <name>' },
  { ask: 'how does this reach that', short: 'how this reaches that', tool: 'get_flow({entry, to})', command: 'flowatlas path <from> <to>' },
  { ask: 'everything about one name, to hand on', short: 'all about a name', tool: 'describe_for_prompt({id})', command: 'flowatlas explain <name>' },
  { ask: 'is this dead', short: 'is it dead', tool: 'dead({id})', command: 'flowatlas dead' },
  { ask: 'why does a flow stop', short: 'why a flow stops', tool: 'cant_follow', command: 'flowatlas doctor --unresolved' },
  { ask: 'is this branch safe to merge', short: 'is a branch safe', tool: 'what_changed({verdict: true})', command: 'flowatlas diff <base>' },
]);

/**
 * How to spend as few turns as an answer allows (P366): what every rendering
 * says, the short block read on every turn included. An agent that checks a
 * complete answer row by row, asks for one id at a time or waits for one call
 * before sending another that does not need it spends a turn each time, and a
 * turn costs more than any answer. One that drops a `maybe` row, read as
 * "nothing runs this", answers what could break with half the list (P367).
 */
export const AGENT_HABITS: readonly string[] = Object.freeze([
  'An answer that says `complete: true` is the whole answer: do not re-check it row by row or with a search; check only what it lists as left unread or unsure.',
  'Keep `reach: "maybe"` rows when asked what breaks or calls something: they sit behind an unread call (`gap`).',
  'Pass several ids in one call (`ids: [...]`), and send independent calls together in one turn.',
  'Answers are compact; ask `verbose: true` only when a field you need is missing.',
]);

/** The rules the full guide states after the habits, loaded when the guide is. */
export const AGENT_RULES: readonly string[] = Object.freeze([
  'Narrow, then read: find the id (find_symbol, list_entries or search), ask what it connects to, then read only the steps that matter.',
  // P368: a question about a field of a message or a body is one call, not a read of every handler.
  'Who reads or sends a field of a message or a body is one call: who_consumes or who_emits with `field`, or check_contract on a route or a `channel`.',
  'Where an answer says the graph could not read something (`unresolvedOnPath`, `cant_follow`), search those files yourself.',
  'An answer with `stale` was built before the files it cites changed: run `flowatlas build` and ask again.',
]);

/** The questions as one line, for the graph server's instructions: the chains there name the tools. */
export const agentQuestionsLine = (): string => `Ask it, not a search of the files: ${AGENT_QUESTIONS.map((question) => question.short).join(', ')}.`;
