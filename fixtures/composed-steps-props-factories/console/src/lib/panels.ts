import type { Entry } from './lists';

/** The panels installed, kept in an instance's field. */
export class PanelRegistry {
  items: Entry[] = [];

  routes(): Entry[] {
    return this.items.map((panel) => ({ ...panel, path: `/panels${panel.path}` }));
  }
}

/** The console's panels. */
export const panels = new PanelRegistry();

/** Panels nobody shows: another instance of the same class. */
export const drafts = new PanelRegistry();
