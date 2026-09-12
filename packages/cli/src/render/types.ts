import type { DetailLevel, TypeEntry } from '@flowatlas/core';
import type { FlowNode } from '@flowatlas/mcp';
import type { Format } from '../options.js';
import type { RepoPalette } from './color.js';

/** One symbol's code, as `--detail=3` quotes it. */
export interface SourceBlock {
  file: string;
  line: number;
  endLine: number;
  code: string;
}

/**
 * Everything a renderer is told beyond the tree itself.
 *
 * The tree carries the graph; this carries how much of it to show and what the
 * command wants said around it. A human format reads `footer`, a machine format
 * reads `extra`, and neither has to know which command it is serving.
 */
export interface RenderOptions {
  detail: DetailLevel;
  color?: boolean;
  ascii?: boolean;
  repoPalette?: RepoPalette;
  /** Lines a reader sees under the tree. */
  footer?: readonly string[];
  /** Fields a machine format carries beside the tree. */
  extra?: Record<string, unknown>;
  /** Set only when something was left out, and it always says how much. */
  truncated?: string;
  /** Types the tree mentions, expanded; from L2. */
  types?: Record<string, TypeEntry>;
  /** Source by node id; only at L3, and only for the formats that show code. */
  source?: Record<string, SourceBlock>;
}

/**
 * One way of drawing a walk.
 *
 * Every format renders the same tree, so a format can never see a node a
 * different format would have hidden: detail is decided before this runs.
 */
export interface Renderer {
  name: Format;
  render(tree: FlowNode, options: RenderOptions): string;
}
