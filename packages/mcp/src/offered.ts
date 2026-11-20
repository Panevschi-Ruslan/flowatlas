/**
 * No answer suggests a tool this server does not list (P360).
 *
 * Answers end with the calls that take the ids they returned (`next`), and
 * some rows, notes and Markdown texts name a tool too. They are written from
 * the graph, which says nothing about the server answering from it: a server
 * started on a database alone lists no `get_source`, one with no observed file
 * no run-time tools. An agent handed a call to a tool it was never offered
 * spends a turn looking for it and finds nothing. So every answer passes
 * through here on its way out, once, whatever tool wrote it: a call to a tool
 * not listed is left out, and one that would have read code says where to
 * read it instead, by file and line.
 *
 * What is said about which tools are not listed and when they appear
 * (`start_here`'s `hidden`) is the one place a hidden tool is named on
 * purpose, and is left as it is.
 */
import { isToolName, type ToolName } from './tool-needs.js';

/** What an answer may name, as the server decided its list. */
export interface Offer {
  /** The tools not listed now. */
  hidden: ReadonlySet<ToolName>;
  /** Where a symbol's code is, said as `src/x.ts:12 in orders`; undefined when the graph does not place it. */
  readAt?: (symbol: string, line?: number) => string | undefined;
  /** Why the code is not served, said after where to read it. */
  noCode: string;
}

/** Keys whose value says on purpose which tools are not listed. */
const KEPT_KEYS: ReadonlySet<string> = new Set(['hidden']);

/** A call as `next` writes one: `tool({...})`. */
const CALL = /^\s*([a-z][a-z0-9_]*)\(/;

/** A list item whose subject is one call: `- \`tool(...)\` rest`, `2. \`tool(...)\` rest`. */
const CALL_ITEM = /^(\s*(?:[-*]|\d+\.)\s+)`([^`]+)`(.*)$/;

/** A tool's name as the server spells one, `lower_case` or called: what a step that suggests something holds. */
const NAMES_A_CALL = /\b[a-z]+_[a-z_]+\b|\b[a-z_]+\(/;

const SYMBOL_ARG =/\bsymbol: ("(?:[^"\\]|\\.)*")/;
const FROM_LINE_ARG = /\bfromLine: (\d+)/;

/** The tool a call names, when it is one of the server's. */
export const toolOfCall = (text: string): ToolName | undefined => {
  const name = CALL.exec(text)?.[1];
  return name !== undefined && isToolName(name) ? name : undefined;
};

class Scrubber {
  readonly #offer: Offer;
  readonly #named: RegExp;

  constructor(offer: Offer) {
    this.#offer = offer;
    this.#named = new RegExp(`\\b(?:${[...offer.hidden].join('|')})\\b`);
  }

  /** The value with every suggestion of a hidden tool taken out; `undefined` for a string left with nothing to say. */
  value(value: unknown): unknown {
    if (typeof value === 'string') return this.text(value);
    if (Array.isArray(value)) {
      const kept: unknown[] = [];
      let changed = false;
      for (const item of value) {
        const scrubbed = this.value(item);
        if (scrubbed !== item) changed = true;
        if (scrubbed !== undefined) kept.push(scrubbed);
      }
      // A replacement can say the same place twice: once is enough.
      return changed ? [...new Set(kept)] : value;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (KEPT_KEYS.has(key)) {
          out[key] = item;
          continue;
        }
        const scrubbed = this.value(item);
        // A list emptied of its calls goes, as an answer with nothing to suggest has no `next`.
        if (scrubbed === undefined || (Array.isArray(scrubbed) && scrubbed.length === 0 && Array.isArray(item) && item.length > 0)) continue;
        out[key] = scrubbed;
      }
      return out;
    }
    return value;
  }

  /** One string: a call, a Markdown text, or a sentence. */
  text(text: string): string | undefined {
    if (!this.#named.test(text)) return text;
    if (text.includes('\n')) return this.#lines(text);
    const tool = toolOfCall(text);
    if (tool !== undefined && this.#offer.hidden.has(tool)) return this.#instead(text);
    return this.#prose(text);
  }

  /** What to do instead of a call to a hidden tool: read the code where it is, for `get_source`; nothing otherwise. */
  #instead(call: string): string | undefined {
    if (toolOfCall(call) !== 'get_source' || this.#offer.readAt === undefined) return undefined;
    const symbol = SYMBOL_ARG.exec(call)?.[1];
    if (symbol === undefined) return undefined;
    const line = FROM_LINE_ARG.exec(call)?.[1];
    const where = this.#offer.readAt(JSON.parse(symbol) as string, line === undefined ? undefined : Number(line));
    return where === undefined ? undefined : `read ${where}: ${this.#offer.noCode}`;
  }

  /** A Markdown text, line by line; a section left with no line goes with its heading. */
  #lines(text: string): string {
    const kept: string[] = [];
    const ended = text.endsWith('\n');
    for (const line of (ended ? text.slice(0, -1) : text).split('\n')) {
      if (!this.#named.test(line)) {
        kept.push(line);
        continue;
      }
      const item = CALL_ITEM.exec(line);
      const tool = item === null ? undefined : toolOfCall(item[2] as string);
      if (item !== null && tool !== undefined && this.#offer.hidden.has(tool)) {
        const instead = this.#instead(item[2] as string);
        if (instead !== undefined) kept.push(`${item[1]}${instead}${item[3]}`);
        continue;
      }
      const said = this.#prose(line);
      if (said !== undefined) kept.push(said);
    }
    return `${withoutEmptySections(kept).join('\n')}${ended ? '\n' : ''}`;
  }

  /**
   * A sentence or a line of prose, with each part that names a hidden tool
   * left out: a parenthesis, a step of a `->` chain, a `;` clause, a
   * sentence. `undefined` when nothing is left.
   */
  #prose(text: string): string | undefined {
    const sentences = text.split(/(?<=\.)\s+/).flatMap((sentence) => {
      const stop = sentence.endsWith('.') ? '.' : '';
      const body = withoutParentheses(stop === '' ? sentence : sentence.slice(0, -1), this.#named);
      const clauses = body.split('; ').flatMap((clause) => {
        if (!this.#named.test(clause)) return [clause];
        const steps = clause.split(' -> ');
        if (steps.length > 1 && !this.#named.test(steps[0] as string)) {
          const kept = steps.filter((step) => !this.#named.test(step));
          // A first step left alone that names no call says nothing to do: it led to the one taken out.
          return kept.length === 1 && !NAMES_A_CALL.test(kept[0] as string) ? [] : [kept.join(' -> ')];
        }
        return [];
      });
      const said = clauses.join('; ');
      return said.trim() === '' || /^\s*(?:[-*]|\d+\.)?\s*$/.test(said) ? [] : [`${said}${stop}`];
    });
    return sentences.length === 0 ? undefined : sentences.join(' ');
  }
}

/** The text with each parenthesis that names a hidden tool left out; a call's own parentheses are not one. */
const withoutParentheses = (text: string, named: RegExp): string => {
  let out = '';
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(' (', at);
    if (open < 0) break;
    let depth = 0;
    let close = -1;
    for (let index = open + 1; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1;
      else if (text[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) break;
    const inside = text.slice(open + 2, close);
    out += text.slice(at, open) + (named.test(inside) ? '' : text.slice(open, close + 1));
    at = close + 1;
  }
  return out + text.slice(at);
};

/** Lines with each `## ` heading whose section has no line left taken out, with the blank line before it. */
const withoutEmptySections = (lines: readonly string[]): string[] => {
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.startsWith('## ')) {
      let next = index + 1;
      while (next < lines.length && (lines[next] as string).trim() === '') next += 1;
      if (next >= lines.length || (lines[next] as string).startsWith('## ')) {
        if (kept.length > 0 && (kept.at(-1) as string).trim() === '') kept.pop();
        index = next - 1;
        continue;
      }
    }
    kept.push(line);
  }
  return kept;
};

/** An answer with no suggestion of a tool the offer hides; the same object when it hides none. */
export const offeredOnly = <T>(value: T, offer: Offer | undefined): T => {
  if (offer === undefined || offer.hidden.size === 0) return value;
  return new Scrubber(offer).value(value) as T;
};

/** One text with no suggestion of a tool the offer hides. */
export const offeredText = (text: string, offer: Offer | undefined): string => {
  if (offer === undefined || offer.hidden.size === 0) return text;
  return new Scrubber(offer).text(text) ?? '';
};
