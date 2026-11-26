/**
 * Marking an answer against the key (P238).
 *
 * Every arm is asked to end with an `ANSWER:` line, and that line is what is
 * marked. An answer without one is read with the scorer's patterns - routes,
 * `Class.method`, file names, yes or no - and marked as `patterns`, so the
 * report can say how many answers were read that way. One the patterns cannot
 * read either is `unscored`, counted, and marked wrong.
 *
 * Sets are marked by precision and recall; `score` is their F1, and `correct`
 * means the set was exactly right. An expected empty set is right only when
 * the answer is empty too: "nothing handles it" is an answer.
 *
 * A find-the-bug question (P392, one with `decoys`) is marked as true
 * positives minus false positives, OWASP's way: `score` is (TP - FP) over the
 * defects planted, from -1 to 1, so an answer that names everything odd is
 * marked down for every twin and every other row it names, and `decoyHits`
 * says how many of the false positives were the planted twins.
 *
 * A file of a change task (`paths`) is its repository's folder and its path
 * there. One named without its repository counts where exactly one expected
 * file ends with it, since two repositories can hold files of one name.
 */

/** The last `ANSWER:` line, parsed as JSON when it is, else as its text. */
export const answerLine = (text) => {
  const found = [...String(text).matchAll(/^\s*\**ANSWER:?\**\s*:?\s*(.+?)\s*$/gim)];
  if (found.length === 0) return undefined;
  const raw = found[found.length - 1][1].replace(/^`+|`+$/g, '');
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const PATTERNS = {
  symbols: /\b[A-Z][A-Za-z0-9]+\.[a-z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g,
  routes: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s`'",)\]]*/g,
  files: /[\w./-]+\.(?:tsx?|tf)\b/g,
  paths: /[\w.-]+(?:\/[\w.-]+)+\.(?:tsx?|tf|ya?ml)\b/g,
  names: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
};

/** `GET /a/:id`, `get /a/{id}/` and `GET /a/:param` are one route. */
export const routeOf = (text) => {
  const match = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)/i.exec(String(text));
  if (match === null) return undefined;
  const path = match[2].replace(/[`'",.;)\]]+$/, '').replace(/\/+$/, '') || '/';
  return `${match[1].toUpperCase()} ${path.replace(/:[A-Za-z]+|\{[A-Za-z]+\}/g, ':')}`;
};

/** `Gateway.list()`, `src/x.ts: Gateway.list` and `Gateway.list` are one symbol. */
export const symbolOf = (text) => {
  const cleaned = String(text).replace(/\(\)?/g, ' ').trim();
  const tokens = cleaned.split(/[\s:#,`'"]+/).filter(Boolean);
  const dotted = tokens.filter((token) => /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(token.replace(/\.$/, '')));
  if (dotted.length > 0) return dotted[dotted.length - 1].replace(/\.$/, '');
  return tokens[tokens.length - 1];
};

/** A file by its name: the generator gives every file an answer can name a name of its own. */
export const fileOf = (text) => {
  const match = /([\w.-]+\.(?:tsx?|tf))\b/.exec(String(text));
  return match === null ? undefined : match[1];
};

/** A file with its repository, as written: no leading `./`, quotes or trailing punctuation (P392). */
export const pathOf = (text) => {
  const match = /([\w.-]+(?:\/[\w.-]+)*\.(?:tsx?|tf|ya?ml))\b/.exec(String(text).replace(/\\/g, '/'));
  return match === null ? undefined : match[1].replace(/^(\.\/)+/, '');
};

/** An environment variable's name, wherever it is written (`process.env.X`, `$X`, `X`). */
export const nameOf = (text) => {
  const found = String(text).match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*/g);
  return found === null ? undefined : found[found.length - 1];
};

const NORMAL = { symbols: symbolOf, routes: routeOf, files: fileOf, paths: pathOf, names: nameOf };

/**
 * The given files resolved against the expected ones: as written where one
 * is expected, else the one expected file that ends with it, where only one
 * does (a path given from inside its repository).
 */
const resolvePaths = (given, expected) =>
  given.map((item) => {
    if (expected.has(item)) return item;
    const ending = [...expected].filter((path) => path.endsWith(`/${item}`));
    return ending.length === 1 ? ending[0] : item;
  });

const exactOf = (value) =>
  String(value)
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, '')
    .trim()
    .toLowerCase();

/** What was read from an answer, before it is marked: the items, and how they were found. */
export const extract = (scorer, text) => {
  const line = answerLine(text);
  if (scorer === 'yesno' || scorer === 'exact') {
    if (line !== undefined) return { by: 'answer-line', value: exactOf(Array.isArray(line) ? line.join(', ') : line) };
    if (scorer === 'yesno') {
      const word = /\b(yes|no)\b/i.exec(String(text));
      return word === null ? { by: 'none' } : { by: 'patterns', value: word[1].toLowerCase() };
    }
    return { by: 'none' };
  }
  if (line !== undefined) {
    const items = Array.isArray(line) ? line : String(line).split(/,\s*/).filter((item) => item !== '' && item !== '[]');
    return { by: 'answer-line', items: items.map((item) => NORMAL[scorer](item)).filter((item) => item !== undefined) };
  }
  const found = String(text).match(PATTERNS[scorer]) ?? [];
  if (found.length === 0) return { by: 'none' };
  return { by: 'patterns', items: found.map((item) => NORMAL[scorer](item)).filter((item) => item !== undefined) };
};

/**
 * A find-the-bug answer (P392): true positives minus false positives, over
 * the defects planted; every name not a planted defect is a false positive,
 * and the planted twins among them are counted apart.
 */
const defects = (question, expected, given, by) => {
  const decoys = new Set(question.decoys.map((item) => NORMAL[question.scorer](item)));
  const tp = [...given].filter((item) => expected.has(item)).length;
  const fp = given.size - tp;
  const decoyHits = [...given].filter((item) => decoys.has(item)).length;
  const score = Math.round(((tp - fp) / Math.max(expected.size, 1)) * 1000) / 1000;
  return { score: Math.max(-1, Math.min(1, score)), correct: tp === expected.size && fp === 0, by, tp, fp, decoyHits, precision: given.size === 0 ? 0 : tp / given.size, recall: tp / Math.max(expected.size, 1), given: [...given] };
};

/** One answer marked: `score` from 0 to 1 (from -1 for find the bug), `correct` when fully right, and how it was read. */
export const score = (question, text) => {
  const read = extract(question.scorer, text);
  if (read.by === 'none') return { score: 0, correct: false, by: 'unscored' };
  if (question.scorer === 'yesno' || question.scorer === 'exact') {
    const expected = exactOf(question.expected);
    const value = read.value;
    const same = value === expected || (question.scorer === 'exact' && Number(value) === Number(expected) && value !== '' && !Number.isNaN(Number(value)));
    return { score: same ? 1 : 0, correct: same, by: read.by, value };
  }
  const expected = new Set(question.expected.map((item) => NORMAL[question.scorer](item)));
  const given = new Set(question.scorer === 'paths' ? resolvePaths(read.items, expected) : read.items);
  if (question.decoys !== undefined) return defects(question, expected, given, read.by);
  if (expected.size === 0) {
    const right = given.size === 0;
    return { score: right ? 1 : 0, correct: right, by: read.by, precision: right ? 1 : 0, recall: 1, given: [...given] };
  }
  const hits = [...given].filter((item) => expected.has(item)).length;
  const precision = given.size === 0 ? 0 : hits / given.size;
  const recall = hits / expected.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { score: Math.round(f1 * 1000) / 1000, correct: hits === expected.size && given.size === expected.size, by: read.by, precision, recall, given: [...given] };
};
