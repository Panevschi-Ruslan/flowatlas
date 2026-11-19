import type { ComponentType } from 'react';
import { Exporter } from '../features/screens';

/** One tool: its name and its screen. */
export interface Tool {
  readonly name: string;
  readonly Screen: ComponentType;
}

const TOOLS: Tool[] = [{ name: 'Export', Screen: Exporter }];

/** The tools. */
export function listTools(): Tool[] {
  return TOOLS;
}

/** A tool's route, built by a function of its own. */
export function toRoute(tool: Tool): { path: string; Screen: ComponentType } {
  return { path: `/tools/${tool.name.toLowerCase()}`, Screen: tool.Screen };
}
