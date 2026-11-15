import type { ComponentType } from 'react';

/** One tool: its name, its address and its screen. */
export interface Tool {
  readonly name: string;
  readonly path: string;
  readonly Screen: ComponentType;
}

const tools: Tool[] = [];

/** Adds a tool. */
export function addTool(tool: Tool): void {
  tools.push(tool);
}

/** A tool's route, built by a function of its own. */
function toRoute(tool: Tool): Tool {
  return { ...tool, path: `/tools/${tool.name.toLowerCase()}` };
}

/** The tools' routes. */
export function toolRoutes(): Tool[] {
  return tools.map(toRoute);
}
