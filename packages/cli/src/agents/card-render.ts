import { createFlowatlasServer } from '@flowatlas/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { callSaid, type CardCall, type PlannedCard } from './prompt-hook.js';

/**
 * Renders prompt cards (P386) by asking the graph server itself, so a card
 * holds exactly the compact answer the tool gives an agent (the P97 rule:
 * one text per answer). Loaded only when a prompt names something, which is
 * when the hook pays for starting a server.
 */

/** Each try at a smaller answer, the tool cutting it itself and saying so: ids only, then fewer rows. */
const SMALLER: ReadonlyArray<Record<string, unknown>> = [{}, { detail: 0 }, { detail: 0, maxNodes: 5 }, { detail: 0, maxNodes: 2 }];

interface Answered {
  call: CardCall;
  said: string;
  /** The answer's text at each size tried so far. */
  sizes: string[];
  /** Which size is in the card; past the last, the answer is named, not given. */
  at: number;
}

/** The services an impact answer reaches, beside the target's own. */
const crossesRepository = (text: string, target: string): boolean => {
  try {
    const answer = JSON.parse(text) as { entriesByService?: Record<string, number>; reachedByService?: Record<string, number>; throughChannels?: unknown[] };
    const own = target.split('#')[0];
    const services = [...Object.keys(answer.entriesByService ?? {}), ...Object.keys(answer.reachedByService ?? {})];
    return services.some((service) => service !== own) || (answer.throughChannels?.length ?? 0) > 0;
  } catch {
    return false;
  }
};

const lineOf = (answered: Answered): string =>
  answered.at < answered.sizes.length
    ? `${answered.said}:\n${answered.sizes[answered.at]}`
    : `${answered.said}: ${(answered.sizes[0] ?? '').length} characters, more than this note has room for; call it.`;

/**
 * The cards' body within `room` characters: every call's answer, the largest
 * asked again smaller until all fit, an answer that fits at no size named by
 * its call; then the names past the cards, by their calls, as far as room
 * allows. `body` is undefined when no card was kept.
 */
export const renderCards = async (
  dbPath: string,
  cards: readonly PlannedCard[],
  more: readonly PlannedCard[],
  room: number,
): Promise<{ body?: string; keys: string[]; calls: string[] }> => {
  // The hook's calls are not an agent's questions: the question log, where it is switched on by the environment, does not record them.
  const logging = process.env['FLOWATLAS_LOG_QUESTIONS'];
  delete process.env['FLOWATLAS_LOG_QUESTIONS'];
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ dbPath, toolsPollMs: 0 });
  if (logging !== undefined) process.env['FLOWATLAS_LOG_QUESTIONS'] = logging;
  const client = new Client({ name: 'flowatlas-prompt-card', version: '0' });
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const ask = async (call: CardCall, size: number): Promise<string | undefined> => {
      const response = await client.callTool({ name: call.tool, arguments: { ...call.args, ...SMALLER[size] } });
      if (response.isError === true) return undefined;
      const content = response.content as Array<{ type: string; text?: string }>;
      return content.map((part) => part.text ?? '').join('');
    };

    const kept: Array<{ card: PlannedCard; answers: Answered[] }> = [];
    for (const card of cards) {
      const answers: Answered[] = [];
      for (const call of card.calls) {
        const text = await ask(call, 0);
        if (text !== undefined) answers.push({ call, said: callSaid(call), sizes: [text], at: 0 });
      }
      if (answers.length === 0) continue;
      if (card.crossingOnly === true && !crossesRepository(answers[0]!.sizes[0]!, String(card.calls[0]!.args['symbol'] ?? ''))) continue;
      kept.push({ card, answers });
    }
    if (kept.length === 0) return { keys: [], calls: [] };

    const all = kept.flatMap((each) => each.answers);
    const moreLine = more.length === 0 ? '' : `Also named here, not answered: ${more.map((card) => card.calls.map(callSaid).join(' and ')).join('; ')}.`;
    const moreSaid = moreLine.length <= room / 4 ? moreLine : more.length === 0 ? '' : `Also named here, not answered: ${more.length} more names.`;
    const total = (): number => all.reduce((sum, answered) => sum + lineOf(answered).length + 1, 0) + moreSaid.length;
    while (total() > room) {
      // The largest answer still in the card, asked again one size smaller.
      const largest = all
        .filter((answered) => answered.at < answered.sizes.length)
        .sort((a, b) => lineOf(b).length - lineOf(a).length)[0];
      if (largest === undefined) break;
      const next = largest.at + 1;
      if (next < SMALLER.length) {
        const text = await ask(largest.call, next);
        if (text !== undefined) largest.sizes.push(text);
        else largest.sizes.length = next;
      }
      largest.at = next;
    }
    const lines = [...all.map(lineOf), ...(moreSaid === '' ? [] : [moreSaid])];
    // Every answer named and still too long (only with very many names): the lines that fit.
    while (lines.length > 1 && lines.join('\n').length > room) lines.pop();
    const given = (answered: Answered): boolean => answered.at < answered.sizes.length;
    return {
      body: lines.join('\n'),
      // A name whose answer was only named is said again next time, with room to answer it.
      keys: kept.filter((each) => each.answers.some(given)).map((each) => each.card.key),
      calls: all.filter(given).map((answered) => answered.said),
    };
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
};
