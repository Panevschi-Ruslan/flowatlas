import type { Panel, PanelRegistry } from '../lib/panels';

/** Adds a panel to the registry it is handed. */
export function installPanel(registry: PanelRegistry, panel: Panel): void {
  registry.items.push(panel);
}
