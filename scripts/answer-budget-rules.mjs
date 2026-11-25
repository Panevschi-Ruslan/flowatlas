/**
 * The rules `answer-budget.mjs` holds answers to (P373), apart from the
 * server it asks, so `answer-budget.test.mjs` can hold the rules themselves.
 */

/** The most a size recorded at `recorded` may grow to: 10% or 300 characters past it, whichever is larger. */
export const ceilingOf = (recorded, { ratio, chars }) => Math.max(Math.ceil(recorded * (1 + ratio)), recorded + chars);

/** Tokens, estimated: a quarter of the characters (JSON of ids and short words). */
export const tokensOf = (chars) => Math.ceil(chars / 4);

/**
 * The lists of an answer, by the names a question gives: a top-level array
 * (`entries`), an object said as its one row (`root`, a tree), every list
 * under a key (`results.*`, a search's lists by kind, each named by its kind),
 * and under `answers` (several asked in one call) each answer's lists merged
 * by name, or each answer as a row of `answers` when the answers are
 * themselves the rows (`dead` with `ids`), with a list said beside them for
 * all of them (`waysIn`).
 */
export const listsOf = (answer, names) => {
  const found = new Map();
  const add = (name, rows) => found.set(name, [...(found.get(name) ?? []), ...rows]);
  const one = (doc) => {
    for (const name of names) {
      if (name === 'answers') continue;
      if (name.endsWith('.*')) {
        const holder = doc[name.slice(0, -2)];
        if (holder !== null && typeof holder === 'object') for (const [kind, rows] of Object.entries(holder)) if (Array.isArray(rows)) add(kind, rows);
        continue;
      }
      const value = doc[name];
      if (Array.isArray(value)) add(name, value);
      else if (value !== null && typeof value === 'object') add(name, [value]);
    }
  };
  if (Array.isArray(answer.answers)) {
    for (const each of answer.answers) {
      if (names.includes('answers')) add('answers', [each]);
      else one(each);
    }
  }
  // A list said once for all the answers (who_calls's waysIn, P376) is the call's own.
  one(answer);
  return found;
};

/** Every row of a list, and each row of a tree under it (`children`). */
export const rowsOf = (rows) =>
  rows.flatMap((row) => (row !== null && typeof row === 'object' ? [row, ...rowsOf(Array.isArray(row.children) ? row.children : [])] : []));

/** What a row is matched by: its `id`, on a field's row its `field`, and on a row of `throughChannels` its `consumer` (P378). */
export const keysOf = (row) => [row.id, row.field, row.consumer, row.caller].filter((key) => typeof key === 'string');

/** The rows of every list across the pages of one question's answers. */
export const rowsByList = (answers, names) => {
  const lists = new Map();
  for (const answer of answers) for (const [name, rows] of listsOf(answer, names)) lists.set(name, [...(lists.get(name) ?? []), ...rowsOf(rows)]);
  return lists;
};

/**
 * A call `next` names, as `{ tool, args }`: `who_calls({symbol: "…", depth: 6})`
 * with its keys quoted made JSON. Undefined for one that does not read so.
 */
export const parseCall = (text) => {
  const match = /^([a-z_]+)\((.*)\)$/s.exec(text);
  if (match === null) return undefined;
  try {
    const args = match[2] === '' ? {} : JSON.parse(match[2].replace(/([{,]\s*)([A-Za-z_]\w*):/g, '$1"$2":'));
    return { tool: match[1], args };
  } catch {
    return undefined;
  }
};

/** The inputs a call may change and still ask the same question: the page, and how far a walk goes. */
const WALKS_ON = new Set(['offset', 'depth', 'maxNodes']);

/**
 * The call an agent makes next for an answer that is not complete: the page
 * `nextOffset` names, or a call `next` names of the same tool with the same
 * inputs but how far it walks (a deeper `who_calls`). `paged` says whether
 * its rows add to the answer's (a page) or replace them (a deeper walk).
 * Undefined when the answer is complete, or nothing more of it can be asked.
 */
export const followOn = (tool, args, answer) => {
  if (answer.complete !== false) return undefined;
  if (typeof answer.nextOffset === 'number') return { args: { ...args, offset: answer.nextOffset }, paged: true };
  const call = furtherIn(tool, args, answer);
  return call === undefined ? undefined : { args: call.args, paged: 'offset' in call.args && call.args.offset !== args.offset };
};

/**
 * The call of `next` that asks the same question further: the same tool and
 * inputs, but how far it walks or the page. Undefined where `next` names none.
 */
export const furtherIn = (tool, args, answer) => {
  for (const text of answer.next ?? []) {
    const call = parseCall(text);
    if (call === undefined || call.tool !== tool) continue;
    const keys = new Set([...Object.keys(args), ...Object.keys(call.args)]);
    const same = [...keys].every((key) => WALKS_ON.has(key) || JSON.stringify(args[key]) === JSON.stringify(call.args[key]));
    const further = [...keys].some((key) => WALKS_ON.has(key) && JSON.stringify(args[key]) !== JSON.stringify(call.args[key]));
    if (same && further) return call;
  }
  return undefined;
};

/** An answer that says it is complete and still has `next` ask the same call further (P376): the agent would ask it. */
export const asksFurther = (tool, args, answer) => {
  if (answer.complete !== true) return undefined;
  const call = furtherIn(tool, args, answer);
  return call === undefined ? undefined : `answered complete, yet next asks it further: ${tool}(${JSON.stringify(call.args)})`;
};

/**
 * What the hand-written right answer (`expect`) says an answer gets wrong:
 * an error, an id a list must hold and misses, one it must not hold and
 * does, a row past an exact list or said twice in one, a field a row must say otherwise,
 * `complete: false` where the right answer is complete, `complete: true`
 * where it is not (a filtered or fuzzy answer, P381), and more than one
 * call for an answer that said it was complete.
 */
export const wrongIn = (expect, { first, lists, measured }) => {
  const wrong = [];
  if (first.error !== undefined) wrong.push(`answered an error: ${first.error}`);
  // A plain-text answer (P382): what its text must hold.
  for (const said of expect.says ?? []) if (typeof first.text !== 'string' || !first.text.includes(said)) wrong.push(`the text does not say ${JSON.stringify(said)}`);
  for (const said of expect.saysNot ?? []) if (typeof first.text === 'string' && first.text.includes(said)) wrong.push(`the text says ${JSON.stringify(said)}, which it must not`);
  const listed = (name) => new Set((lists.get(name) ?? []).flatMap(keysOf));
  for (const [name, ids] of Object.entries(expect.lists ?? {})) {
    const held = listed(name);
    for (const id of ids) if (!held.has(id)) wrong.push(`${name} misses ${id}`);
  }
  for (const [name, ids] of Object.entries(expect.notListed ?? {})) {
    const held = listed(name);
    for (const id of ids) if (held.has(id)) wrong.push(`${name} lists ${id}, which it must not`);
  }
  for (const [name, said] of Object.entries(expect.rowsSay ?? {})) {
    const rows = lists.get(name) ?? [];
    for (const [id, fields] of Object.entries(said)) {
      const row = rows.find((each) => keysOf(each).includes(id));
      if (row === undefined) {
        wrong.push(`${name} misses ${id}`);
        continue;
      }
      for (const [field, value] of Object.entries(fields)) {
        if (JSON.stringify(row[field]) !== JSON.stringify(value)) wrong.push(`${name} says ${field}: ${JSON.stringify(row[field])} on ${id}, where it is ${JSON.stringify(value)}`);
      }
    }
  }
  for (const name of expect.exact ?? []) {
    const want = new Set([...(expect.lists?.[name] ?? []), ...Object.keys(expect.rowsSay?.[name] ?? {})]);
    const seen = new Set();
    for (const row of lists.get(name) ?? []) {
      const keys = keysOf(row);
      if (!keys.some((key) => want.has(key))) wrong.push(`${name} lists ${keys[0] ?? JSON.stringify(row)}, past the ${want.size} it must hold exactly`);
      // An exact list says each row once (P378): one consumer on three channels is one row of throughChannels.
      else if (seen.has(keys[0])) wrong.push(`${name} lists ${keys[0]} more than once`);
      seen.add(keys[0]);
    }
  }
  if (expect.complete === true && !measured.complete) wrong.push('says complete: false where the right answer is complete');
  // A filtered, fuzzy or half answer that calls itself whole is the worst answer there is (P381).
  if (expect.complete === false && first.complete === true) wrong.push('says complete: true where the right answer is not complete');
  // An answer that says it is complete is the whole answer: the question took the one call.
  if (first.complete === true && measured.calls !== 1) wrong.push(`answered complete, yet took ${measured.calls} calls`);
  // An answer that settles its question says so, and names no further call beside it (P403).
  if (expect.settled === true && typeof first.settled !== 'string') wrong.push('does not say settled where the answer settles the question');
  if (typeof first.settled === 'string' && first.next !== undefined) wrong.push('says settled, yet names a further call in next');
  return wrong;
};

/**
 * What the sizes say against their budget: a problem for a size past its
 * ceiling or a question taking more calls than recorded, a note for one well
 * under (an `--update` lowers it).
 */
export const overBudget = (id, now, was, tolerance) => {
  const problems = [];
  const notes = [];
  const ceiling = ceilingOf(was.chars, tolerance);
  if (now.chars > ceiling) problems.push(`${id}: ${now.chars} characters, past its budget of ${was.chars} (at most ${ceiling})`);
  else if (was.chars - now.chars > Math.max(was.chars * tolerance.ratio, tolerance.chars)) notes.push(`${id}: ${now.chars} characters, well under its budget of ${was.chars}; --update lowers it`);
  if (was.calls !== undefined && now.calls > was.calls) problems.push(`${id}: takes ${now.calls} calls, past its budget of ${was.calls}`);
  return { problems, notes };
};
