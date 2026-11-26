import type { ComponentType } from 'react';

/** One panel of the dashboard. */
export interface Panel {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** The dashboard's panels, kept by the object that adds and lists them. */
export const panels = {
  items: [] as Panel[],
  add(panel: Panel) {
    this.items.push(panel);
  },
  all(): Panel[] {
    return this.items;
  },
};
