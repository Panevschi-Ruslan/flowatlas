/**
 * The parts of a single-file component, found by reading its text (P233).
 *
 * A component file is markup at its top level: a `<template>`, one or two
 * `<script>`s, a `<style>`, and blocks of the project's own. What a block
 * holds is not read here, only where it starts and ends, so a `>` inside a
 * quoted attribute, a `<template>` nested in the template, a comment, and a
 * `<script>` that names its source elsewhere are what this has to get right.
 * Every offset is into the file's own text, so a line and a column worked out
 * from one is the file's own.
 */

export interface Block {
  /** The tag's name, lower case. */
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string | true>;
  /** Where the opening tag starts. */
  readonly start: number;
  /** Where the content starts and ends; equal for a block written `<x />`. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** Where the closing tag ends. */
  readonly end: number;
}

const NAME = /[A-Za-z][\w:.-]*/y;
const SPACE = /\s/;

/** The end of a tag's attributes - the offset of its `>` - with each attribute read; quotes and braces respected. */
export const readTag = (text: string, from: number): { attributes: Map<string, { value: string | true; at: number; valueAt: number }>; end: number; selfClosing: boolean } | undefined => {
  const attributes = new Map<string, { value: string | true; at: number; valueAt: number }>();
  let at = from;
  while (at < text.length) {
    const char = text[at] as string;
    if (SPACE.test(char)) {
      at += 1;
      continue;
    }
    if (char === '>') return { attributes, end: at, selfClosing: false };
    if (char === '/' && text[at + 1] === '>') return { attributes, end: at + 1, selfClosing: true };
    // An attribute written as an expression in braces: Svelte's `{onclick}` and `{...props}`.
    if (char === '{') {
      const close = closingBrace(text, at);
      if (close === -1) return undefined;
      attributes.set(text.slice(at, close + 1), { value: true, at, valueAt: at });
      at = close + 1;
      continue;
    }
    const nameStart = at;
    while (at < text.length && !SPACE.test(text[at] as string) && !'=>'.includes(text[at] as string) && !(text[at] === '/' && text[at + 1] === '>')) at += 1;
    const name = text.slice(nameStart, at);
    if (name === '') {
      at += 1;
      continue;
    }
    let look = at;
    while (look < text.length && SPACE.test(text[look] as string)) look += 1;
    if (text[look] !== '=') {
      attributes.set(name, { value: true, at: nameStart, valueAt: at });
      continue;
    }
    look += 1;
    while (look < text.length && SPACE.test(text[look] as string)) look += 1;
    const quote = text[look];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, look + 1);
      if (close === -1) return undefined;
      attributes.set(name, { value: text.slice(look + 1, close), at: nameStart, valueAt: look + 1 });
      at = close + 1;
    } else if (quote === '{') {
      const close = closingBrace(text, look);
      if (close === -1) return undefined;
      attributes.set(name, { value: text.slice(look, close + 1), at: nameStart, valueAt: look });
      at = close + 1;
    } else {
      const valueStart = look;
      while (look < text.length && !SPACE.test(text[look] as string) && text[look] !== '>') look += 1;
      attributes.set(name, { value: text.slice(valueStart, look), at: nameStart, valueAt: valueStart });
      at = look;
    }
  }
  return undefined;
};

/** The `}` that closes the `{` at `open`, past strings and nested braces; -1 when there is none. */
export const closingBrace = (text: string, open: number): number => {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at];
    if (char === '"' || char === "'" || char === '`') {
      const close = endOfString(text, at);
      if (close === -1) return -1;
      at = close;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
};

const endOfString = (text: string, open: number): number => {
  const quote = text[open];
  for (let at = open + 1; at < text.length; at += 1) {
    if (text[at] === '\\') {
      at += 1;
      continue;
    }
    if (text[at] === quote) return at;
  }
  return -1;
};

/** Where a closing tag of `name` starts, from `from`, with nesting counted for a tag that nests. */
const closingTag = (text: string, name: string, from: number, nests: boolean): number => {
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
  const close = new RegExp(`</${name}\\s*>`, 'gi');
  if (!nests) {
    close.lastIndex = from;
    return close.exec(text)?.index ?? -1;
  }
  let depth = 1;
  let at = from;
  for (;;) {
    open.lastIndex = at;
    close.lastIndex = at;
    const nextOpen = open.exec(text);
    const nextClose = close.exec(text);
    if (nextClose === null) return -1;
    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      const tag = readTag(text, nextOpen.index + name.length + 1);
      depth += tag?.selfClosing === true ? 0 : 1;
      at = (tag?.end ?? nextOpen.index) + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose.index;
    at = nextClose.index + nextClose[0].length;
  }
};

/**
 * The blocks at a component file's top level, in order.
 *
 * `nesting` names the blocks whose content can hold the same tag (a
 * `<template>` in a template); every other block ends at its first closing
 * tag, which is what a `<script>` holding the text `"</div>"` needs.
 */
export const topLevelBlocks = (text: string, nesting: ReadonlySet<string> = new Set(['template'])): Block[] => {
  const blocks: Block[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('<', at);
    if (open === -1) break;
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4);
      at = close === -1 ? text.length : close + 3;
      continue;
    }
    NAME.lastIndex = open + 1;
    const named = NAME.exec(text);
    if (named === null) {
      at = open + 1;
      continue;
    }
    const name = named[0].toLowerCase();
    const tag = readTag(text, open + 1 + named[0].length);
    if (tag === undefined) break;
    const attributes = new Map([...tag.attributes].map(([key, attribute]) => [key.toLowerCase(), attribute.value] as const));
    if (tag.selfClosing) {
      blocks.push({ name, attributes, start: open, contentStart: tag.end + 1, contentEnd: tag.end + 1, end: tag.end + 1 });
      at = tag.end + 1;
      continue;
    }
    const contentStart = tag.end + 1;
    const close = closingTag(text, named[0], contentStart, nesting.has(name));
    if (close === -1) break;
    const end = text.indexOf('>', close) + 1;
    blocks.push({ name, attributes, start: open, contentStart, contentEnd: close, end });
    at = end;
  }
  return blocks;
};

/** Every `<script>` and `<style>` in a file whose markup is not one block (Svelte's), with the rest left to the caller. */
export const scriptAndStyleBlocks = (text: string): Block[] => {
  const found: Block[] = [];
  const opening = /<(script|style)(?=[\s>/])/gi;
  for (let match = opening.exec(text); match !== null; match = opening.exec(text)) {
    const name = (match[1] as string).toLowerCase();
    const tag = readTag(text, match.index + name.length + 1);
    if (tag === undefined) break;
    const attributes = new Map([...tag.attributes].map(([key, attribute]) => [key.toLowerCase(), attribute.value] as const));
    if (tag.selfClosing) {
      found.push({ name, attributes, start: match.index, contentStart: tag.end + 1, contentEnd: tag.end + 1, end: tag.end + 1 });
      opening.lastIndex = tag.end + 1;
      continue;
    }
    const close = closingTag(text, name, tag.end + 1, false);
    if (close === -1) break;
    const end = text.indexOf('>', close) + 1;
    found.push({ name, attributes, start: match.index, contentStart: tag.end + 1, contentEnd: close, end });
    opening.lastIndex = end;
  }
  return found;
};

/** 1-based line and column of an offset into a text. */
export const positionAt = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let at = 0; at < offset && at < text.length; at += 1) {
    if (text[at] === '\n') {
      line += 1;
      lineStart = at + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
};
