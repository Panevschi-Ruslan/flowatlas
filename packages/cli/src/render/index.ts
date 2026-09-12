import type { Format } from '../options.js';
import { renderJson } from './json.js';
import { renderMermaid } from './mermaid.js';
import { renderTree } from './tree.js';
import type { Renderer } from './types.js';

/**
 * Every way of drawing a walk, by name.
 *
 * A later phase adds a format by adding a row here; no command learns about it,
 * which is what keeps format and detail from growing into each other.
 */
const RENDERERS: Record<Format, Renderer> = {
  tree: { name: 'tree', render: renderTree },
  mermaid: { name: 'mermaid', render: renderMermaid },
  json: { name: 'json', render: renderJson },
};

export const getRenderer = (format: Format): Renderer => RENDERERS[format];

export { renderJson } from './json.js';
export { renderMermaid, sanitiseIds } from './mermaid.js';
export { renderTree, truncationLine } from './tree.js';
export { graphOf } from './graphify.js';
export type { FlatGraph, Link } from './graphify.js';
export { repoPalette, noPalette, REPO_COLORS, uncolored } from './color.js';
export type { Paint, RepoPalette } from './color.js';
export {
  ASCII_PREFIX,
  CONFIDENCE_MARK,
  KIND_PREFIX,
  NODE_PREFIX,
  prefixFor,
  prefixWidth,
} from './prefixes.js';
export type { Renderer, RenderOptions, SourceBlock } from './types.js';
