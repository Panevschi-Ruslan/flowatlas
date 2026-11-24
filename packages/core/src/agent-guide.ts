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
  // P382: a field of a body or a message is one call, where agents read every handler for it.
  { ask: "does each side still send what the other reads: a route's body, a message's fields", short: 'does each side send what the other reads', tool: 'check_contract({route} or {channel})', command: 'flowatlas contracts' },
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
 * One that edits a route or a payload before asking breaks a caller in a
 * repository it never opened (P382).
 */
export const AGENT_HABITS: readonly string[] = Object.freeze([
  'Before changing a route, handler, body type or message payload: `impact` first.',
  'An answer with `complete: true` is the whole answer: check only what it lists as unread or unsure, not its rows; keep `reach: "maybe"` rows (behind an unread call) when asked what breaks.',
  // P382: each tool's own key, where one `ids` was named for all and who_calls refused it.
  'Several in one call: who_calls and impact `symbols`, dead `ids`, find_symbol and search `queries`, get_type `types`; independent calls in one turn.',
  'Answers are compact: `verbose: true` gives every field.',
]);

/**
 * The same habits for an assistant that asks the graph in a terminal, with no
 * server (`flowatlas agents install --terminal`, P392): each command prints
 * the server's answer to the same question with `--format json`, so what an
 * answer says (`complete`, `reach`) reads the same, and only how to ask
 * differs.
 */
export const AGENT_TERMINAL_HABITS: readonly string[] = Object.freeze([
  'Before changing a route, handler, body type or message payload: `flowatlas impact <symbol>` first.',
  'An answer with `complete: true` is the whole answer: check only what it lists as unread or unsure; keep `reach: "maybe"` rows when asked what breaks.',
  'Answers are compact: `--verbose` gives every field; run independent commands in one turn.',
]);

/** The rules the terminal guide states after its habits (P392). */
export const AGENT_TERMINAL_RULES: readonly string[] = Object.freeze([
  'One command per question: each takes the name as you have it (an id, `Class.method`, a route said aloud) and `--service` picks among same-named ones.',
  'Where an answer says the graph could not read something (`unresolvedOnPath`, `cant_follow`), search those files yourself.',
  'An answer with `stale` was built before the files it cites changed: run `flowatlas build` and ask again.',
]);

/** The rules the full guide states after the habits, loaded when the guide is. */
export const AGENT_RULES: readonly string[] = Object.freeze([
  // P382: one call per question, where "find the id first" taught a find_symbol call before the question's own tool.
  'One call per question: each tool takes the name as you have it (an id, `Class.method`, a route said aloud) and `service` picks among same-named ones; `start_here` is for a project you do not know.',
  // P368: a question about a field of a message or a body is one call, not a read of every handler.
  'Who reads or sends a field of a message or a body is one call: who_consumes or who_emits with `field`, or check_contract on a `route` or a `channel`.',
  'Where an answer says the graph could not read something (`unresolvedOnPath`, `cant_follow`), search those files yourself.',
  'An answer with `stale` was built before the files it cites changed: run `flowatlas build` and ask again.',
]);

/**
 * The questions as one line, each with the call that answers it, for the
 * graph server's instructions (P382): a question is one call, so the line
 * says which, where it named the questions and left the tools to chains.
 */
export const agentQuestionsLine = (): string => `${AGENT_QUESTIONS.map((question) => `${question.short}: ${question.tool}`).join('; ')}.`;
