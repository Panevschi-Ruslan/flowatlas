import { drafts, panels, type Panel, type PanelRegistry } from '../lib/panels';

/** Adds panels to the registry it is given when it is made, kept as a parameter property. */
export class PanelBook {
  constructor(private readonly registry: PanelRegistry) {}

  add(panel: Panel): void {
    this.registry.items.push(panel);
  }
}

/** Adds panels to the registry it is given when it is made, kept in a field the constructor writes. */
export class PanelShelf {
  private registry: PanelRegistry;

  constructor(registry: PanelRegistry) {
    this.registry = registry;
  }

  put(panel: Panel): void {
    this.keep(panel);
  }

  private keep(panel: Panel): void {
    this.registry.items.push(panel);
  }
}

export const book = new PanelBook(panels);
export const shelf = new PanelShelf(panels);
/** A book over the other registry: what it adds is not one of the console's panels. */
export const draftBook = new PanelBook(drafts);
