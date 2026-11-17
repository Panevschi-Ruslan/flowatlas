import type { ComponentType } from 'react';

/** One panel: its address under the panels, and its screen. */
export interface Panel {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** The panels installed, kept in an instance's field. */
export class PanelRegistry {
  items: Panel[] = [];

  /** Each panel at its address under the panels, flat-mapped to one object over it. */
  routes(): Panel[] {
    return this.items.flatMap((panel) => [{ ...panel, path: `/panels${panel.path}` }]);
  }
}

/** The console's panels: an instance exported for other modules to add to. */
export const panels = new PanelRegistry();

/** Panels nobody shows: another instance of the same class. */
export const drafts = new PanelRegistry();
