/**
 * Every answer held to a size (P403), as `get_source` holds its code to
 * `MAX_CODE_CHARS` since P396.
 *
 * An agent asks for big answers: `list_entries` with a high `maxNodes`, or
 * `who_consumes` with `verbose: true, detail: 2` on a busy channel, each
 * re-sent on every later turn of the session. `maxNodes` counts rows, not
 * what each row says. So every answer, compact or verbose, passes here on its way out:
 * past `MAX_ANSWER_CHARS` its longest list keeps the rows that fit, in the
 * order the tool ranked them, and the answer says what was cut and the call
 * for the rest - the same call at the next `offset` where the tool pages,
 * else the same question narrowed. Verbose keeps every fact of a row it
 * keeps, never unbounded rows.
 */

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The most characters one answer runs to: about 3k tokens, several times the largest the fixtures' questions answer. */
export const MAX_ANSWER_CHARS = 12000;

/** Room kept for what the cut adds: its `left` line and the call in `next`. */
const SAID_ROOM = 600;

/** The most lists one answer is cut in before it is handed on as it is. */
const MOST_CUTS = 4;

/** Fields that are no list of rows, whatever their size: the calls and the cuts already said. */
const NOT_ROWS: ReadonlySet<string> = new Set(['next', 'left']);

/** A call written as `next` writes one, the arguments as given. */
const callSaid = (tool: string, args: Readonly<Plain>): string => {
  const said = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `${tool}(${said.length === 0 ? '' : `{${said.join(', ')}}`})`;
};

/** How many of `rows`, from the first, fit in `room` characters; at least one. */
const rowsWithin = (rows: readonly unknown[], room: number): number => {
  let chars = 2;
  for (let index = 0; index < rows.length; index += 1) {
    chars += JSON.stringify(rows[index]).length + (index === 0 ? 0 : 1);
    if (chars > room) return Math.max(index, 1);
  }
  return rows.length;
};

/** What a cut answers with, beside the rows it keeps. */
export interface Asked {
  tool: string;
  /** The arguments the tool was asked with, `verbose` among them where it was given. */
  args: Readonly<Plain>;
  /** Whether the tool takes `offset`, so the rest is its next page. */
  paged: boolean;
}

/**
 * The answer within `MAX_ANSWER_CHARS`: as it was where it fits; otherwise
 * its longest lists cut to the rows that fit, `complete: false`, `left`
 * naming each cut and `next` the call for the rest.
 */
export const cappedAnswer = <T>(answer: T, asked: Asked, most = MAX_ANSWER_CHARS): T => {
  if (!isPlain(answer)) return answer;
  let size = JSON.stringify(answer).length;
  if (size <= most) return answer;
  const out: Plain = { ...answer };
  const cuts: Array<{ key: string; kept: number; of: number }> = [];
  for (let round = 0; round < MOST_CUTS && size > most; round += 1) {
    const lists = Object.entries(out)
      .filter(([key, value]) => !NOT_ROWS.has(key) && Array.isArray(value) && value.length > 1 && !cuts.some((cut) => cut.key === key))
      .map(([key, value]) => ({ key, rows: value as unknown[], chars: JSON.stringify(value).length }))
      .sort((a, b) => b.chars - a.chars);
    const longest = lists[0];
    if (longest === undefined) break;
    const kept = rowsWithin(longest.rows, most - SAID_ROOM - (size - longest.chars));
    if (kept >= longest.rows.length) break;
    out[longest.key] = longest.rows.slice(0, kept);
    cuts.push({ key: longest.key, kept, of: longest.rows.length });
    size = JSON.stringify(out).length;
  }
  if (cuts.length === 0) return answer;
  const offset = typeof asked.args.offset === 'number' ? asked.args.offset : 0;
  // The tool's own page: the list its `total` counts, which the next page goes on from.
  const page = asked.paged && typeof answer.total === 'number' ? cuts.find((cut) => cut.of <= (answer.total as number)) : undefined;
  const nextOffset = page === undefined ? undefined : offset + page.kept;
  const rest =
    nextOffset !== undefined
      ? callSaid(asked.tool, { ...asked.args, offset: nextOffset })
      : asked.args.verbose === true
        ? callSaid(asked.tool, Object.fromEntries(Object.entries(asked.args).filter(([key]) => key !== 'verbose')))
        : undefined;
  const said = cuts.map((cut) => `cap: ${cut.key} ${cut.kept} of ${cut.of} rows, the answer held to ${most} characters`);
  const narrow = rest === undefined ? ['cap: ask a narrower question (a service, a type, a field) for the rest'] : [];
  const left = Array.isArray(out.left) ? out.left.filter((item): item is string => typeof item === 'string') : [];
  return {
    ...out,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    complete: false,
    left: [...left, ...said, ...narrow],
    ...(rest === undefined ? {} : { next: [rest] }),
  } as T;
};
