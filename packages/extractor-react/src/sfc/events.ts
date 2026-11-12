import { closingBrace, positionAt, readTag, scriptAndStyleBlocks, topLevelBlocks } from './blocks.js';

/**
 * The event bindings of a component's markup (P233): what a person presses.
 *
 * Vue writes one `@click="save"` or `v-on:submit.prevent="send(form)"`;
 * Svelte `on:click={save}` (4) or `onclick={save}` (5), or `{onclick}`
 * alone. Only bindings are read: a value shown, a condition, a loop and
 * `v-model` draw nothing, because none is a way in. The events that fire on
 * every keystroke are left out, as the React reader leaves `onChange` out.
 */
export interface TemplateEvent {
  /** The event, as the markup names it: `click`, `submit`, `custom-event`. */
  readonly event: string;
  /** The binding as written, for a label. */
  readonly attribute: string;
  /** The handler's code. */
  readonly source: string;
  readonly line: number;
  readonly column: number;
  /** What the handler runs, as far as its text says. */
  readonly handlers: readonly TemplateHandler[];
}

/** A name the handler runs: `save`, or `store.add` - a member of something the script holds. */
export type TemplateHandler = { readonly kind: 'name'; readonly name: string } | { readonly kind: 'member'; readonly object: string; readonly name: string };

/** Events that fire while a person types or moves, not when one decides. */
const IGNORED = new Set(['input', 'change', 'blur', 'focus', 'keydown', 'keyup', 'keypress', 'mouseenter', 'mouseleave', 'mousemove', 'scroll', 'focusin', 'focusout']);

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'function', 'await', 'new', 'catch', 'void', 'delete', 'in', 'of', 'async']);
const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/;
const CALLED = /(?<![\w$.])((?:[A-Za-z_$][\w$]*\s*\.\s*)?[A-Za-z_$][\w$]*)\s*\(/g;
const ARROW_HEAD = /^\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/;

const asHandler = (path: string): TemplateHandler | undefined => {
  const [object, name] = path.split('.').map((part) => part.trim());
  if (object === undefined || object.startsWith('$') || KEYWORDS.has(object)) return undefined;
  return name === undefined ? { kind: 'name', name: object } : { kind: 'member', object, name };
};

/**
 * What a handler's code runs: the name it is, when it is one (`save`,
 * `store.add`), else every function it calls (`save(item)`,
 * `() => store.add(x)`, `a(); b()`). An assignment calls nothing and says so
 * by an empty list.
 */
export const handlersOf = (source: string): TemplateHandler[] => {
  let body = source.trim().replace(/;+$/, '');
  const arrow = ARROW_HEAD.exec(body);
  if (arrow !== null) body = body.slice(arrow[0].length).trim();
  if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1).trim();
  if (PATH.test(body)) {
    const one = asHandler(body);
    return one === undefined ? [] : [one];
  }
  const found: TemplateHandler[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(CALLED)) {
    const path = (match[1] as string).replace(/\s+/g, '');
    if (seen.has(path)) continue;
    seen.add(path);
    const handler = asHandler(path);
    if (handler !== undefined) found.push(handler);
  }
  return found;
};

/** Every tag in a stretch of markup, with its name, where it starts and its attributes; text in braces is passed over, so `{a < b}` is not a tag. */
const tagsIn = (text: string, start: number, end: number, braces: 'single' | 'double') => {
  const tags: Array<NonNullable<ReturnType<typeof readTag>> & { name: string; at: number }> = [];
  let at = start;
  while (at < end) {
    const char = text[at];
    if (char === '{' && (braces === 'single' || text[at + 1] === '{')) {
      const close = closingBrace(text, at);
      at = close === -1 ? at + 1 : close + 1;
      continue;
    }
    if (char !== '<') {
      at += 1;
      continue;
    }
    if (text.startsWith('<!--', at)) {
      const close = text.indexOf('-->', at + 4);
      at = close === -1 ? end : close + 3;
      continue;
    }
    const name = /^<[A-Za-z][\w:.-]*/.exec(text.slice(at, at + 80));
    if (name === null) {
      at += 1;
      continue;
    }
    const tag = readTag(text, at + name[0].length);
    if (tag === undefined || tag.end > end) break;
    tags.push({ ...tag, name: name[0].slice(1), at });
    at = tag.end + 1;
  }
  return tags;
};

/** One element of a component's markup (P255): its name as written, where it is, and its attributes as written. */
export interface MarkupTag {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly attributes: ReadonlyMap<string, string | true>;
}

const markupTag = (text: string, tag: ReturnType<typeof tagsIn>[number]): MarkupTag => {
  const { line, column } = positionAt(text, tag.at);
  return { name: tag.name, line, column, attributes: new Map([...tag.attributes].map(([key, attribute]) => [key, attribute.value] as const)) };
};

/** The elements of a Vue component's `<template>`, the template itself left out. */
export const vueTemplateTags = (text: string): MarkupTag[] => {
  const template = topLevelBlocks(text).find((block) => block.name === 'template');
  return template === undefined ? [] : tagsIn(text, template.contentStart, template.contentEnd, 'double').map((tag) => markupTag(text, tag));
};

/** The elements of a Svelte component's markup: everything outside its scripts and styles. */
export const svelteMarkupTags = (text: string): MarkupTag[] => markupStretches(text).flatMap(([start, end]) => tagsIn(text, start, end, 'single').map((tag) => markupTag(text, tag)));

/** A Svelte file's markup, as the stretches between its scripts and styles. */
const markupStretches = (text: string): Array<readonly [number, number]> => {
  const stretches: Array<readonly [number, number]> = [];
  let from = 0;
  for (const block of scriptAndStyleBlocks(text)) {
    stretches.push([from, block.start]);
    from = block.end;
  }
  stretches.push([from, text.length]);
  return stretches;
};

const event = (text: string, attribute: string, name: string, source: string, at: number): TemplateEvent => {
  const { line, column } = positionAt(text, at);
  return { event: name, attribute, source: source.trim(), line, column, handlers: handlersOf(source) };
};

/** The event bindings of a Vue component's `<template>`. */
export const vueTemplateEvents = (text: string): TemplateEvent[] => {
  const template = topLevelBlocks(text).find((block) => block.name === 'template');
  if (template === undefined) return [];
  const events: TemplateEvent[] = [];
  for (const tag of tagsIn(text, template.contentStart, template.contentEnd, 'double')) {
    for (const [key, attribute] of tag.attributes) {
      const written = key.startsWith('@') ? key.slice(1) : key.startsWith('v-on:') ? key.slice(5) : undefined;
      if (written === undefined || written.startsWith('[') || typeof attribute.value !== 'string') continue;
      const name = written.split('.')[0] as string;
      if (IGNORED.has(name.toLowerCase()) || name.startsWith('update:')) continue;
      events.push(event(text, key, name, attribute.value, attribute.at));
    }
  }
  return events;
};

/** The event bindings of a Svelte component's markup: everything outside its scripts and styles. */
export const svelteMarkupEvents = (text: string): TemplateEvent[] => {
  const events: TemplateEvent[] = [];
  for (const [start, end] of markupStretches(text)) {
    for (const tag of tagsIn(text, start, end, 'single')) {
      for (const [key, attribute] of tag.attributes) {
        const shorthand = /^\{\s*(on[a-z]+)\s*\}$/.exec(key);
        if (shorthand !== null) {
          const name = (shorthand[1] as string).slice(2);
          if (!IGNORED.has(name)) events.push(event(text, key, name, shorthand[1] as string, attribute.at));
          continue;
        }
        const written = key.startsWith('on:') ? (key.slice(3).split('|')[0] as string) : /^on[a-z]+$/.test(key) ? key.slice(2) : undefined;
        if (written === undefined || typeof attribute.value !== 'string' || IGNORED.has(written)) continue;
        const value = attribute.value.trim();
        const source = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
        events.push(event(text, key, written, source, attribute.at));
      }
    }
  }
  return events;
};
