import type { ComponentType } from 'react';

/** One panel: its address under the console, and its screen. */
export interface Panel {
  readonly path: string;
  readonly Screen: ComponentType;
}

const panels: Panel[] = [];

/** Where every panel is shown. */
const BASE = '/console';

/** Adds a panel. */
export const addPanel = (panel: Panel): void => {
  panels.push(panel);
};

/** The panels, each at its address under the console. */
export function consolePanels(): Panel[] {
  return panels.map((panel) => ({ ...panel, path: BASE + panel.path }));
}
