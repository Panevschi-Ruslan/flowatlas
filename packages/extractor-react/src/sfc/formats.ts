import type { EmbeddedFormat } from '@flowatlas/core';
import { scriptAndStyleBlocks, topLevelBlocks, type Block } from './blocks.js';
import { svelteMarkupEvents, vueTemplateEvents, type TemplateEvent } from './events.js';

/**
 * The two component formats whose scripts are read as TypeScript (P233).
 *
 * Each says where its scripts are; the core makes the checker's file from
 * that (`addEmbeddedScripts`) and names every position by the component file.
 * The tail is the component itself, as a declaration a pass can key on: it
 * is written after the file's last line, where nothing the file says can be.
 */
export const COMPONENT_TAIL_NAME = '__flowatlasComponent__';
const TAIL = `const ${COMPONENT_TAIL_NAME} = (): void => undefined;`;

/** A script block read in place: not one that names its source elsewhere. */
const inPlace = (block: Block): boolean => block.name === 'script' && block.attributes.get('src') === undefined;

/** The names a template's handlers start from: `save`, and `orders` of `orders.remove`. */
const handlerNames = (events: readonly TemplateEvent[]): string[] => [
  ...new Set(events.flatMap((event) => event.handlers.map((handler) => (handler.kind === 'name' ? handler.name : handler.object)))),
];

const markupLang = (blocks: readonly Block[]): boolean =>
  blocks.some((block) => block.name === 'script' && ['tsx', 'jsx'].includes(String(block.attributes.get('lang') ?? '')));

export const VUE_FORMAT: EmbeddedFormat = {
  extension: '.vue',
  scripts: (text) => {
    const blocks = topLevelBlocks(text);
    return {
      ranges: blocks.filter(inPlace).map((block) => [block.contentStart, block.contentEnd] as const),
      markup: markupLang(blocks),
      tail: TAIL,
      // A name only the template calls is still one the framework imports for it (P240).
      uses: handlerNames(vueTemplateEvents(text)),
    };
  },
};

export const SVELTE_FORMAT: EmbeddedFormat = {
  extension: '.svelte',
  scripts: (text) => {
    const blocks = scriptAndStyleBlocks(text);
    return {
      ranges: blocks.filter(inPlace).map((block) => [block.contentStart, block.contentEnd] as const),
      markup: false,
      tail: TAIL,
      uses: handlerNames(svelteMarkupEvents(text)),
    };
  },
};

/** The `<script src>` a component names, when it names one: its code is in that file. */
export const scriptSourceOf = (text: string, extension: string): string | undefined => {
  const blocks = extension === '.svelte' ? scriptAndStyleBlocks(text) : topLevelBlocks(text);
  const named = blocks.find((block) => block.name === 'script' && typeof block.attributes.get('src') === 'string');
  return named === undefined ? undefined : (named.attributes.get('src') as string);
};

/**
 * The name a component is known by: its file's, which is how both
 * frameworks name it, or the folder and the file where the file's name is
 * one many components share (`index`, `[id]`, `+page`).
 */
export const componentNameOf = (file: string): string => {
  const parts = file.replace(/\.(vue|svelte)$/, '').split('/');
  const base = parts[parts.length - 1] as string;
  return /^[A-Za-z][\w-]*$/.test(base) && base !== 'index' && !base.startsWith('+') ? base : parts.slice(-2).join('/');
};
