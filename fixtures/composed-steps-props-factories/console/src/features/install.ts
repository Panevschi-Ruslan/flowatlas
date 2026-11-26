import { drafts, panels, type PanelRegistry } from '../lib/panels';
import type { Entry } from '../lib/lists';
import { Atlas, Hidden, Usage } from './screens';
import { archive, shelves } from '../lib/shelves';

/** Installs a panel into the registry handed under `registry` in its first parameter. */
export function installPanel({ registry }: { registry: PanelRegistry }, panel: Entry): void {
  registry.items.push(panel);
}

installPanel({ registry: panels }, { path: '/usage', Screen: Usage });
installPanel({ registry: drafts }, { path: '/hidden', Screen: Hidden });

shelves.add({ path: '/atlas', Screen: Atlas });
archive.add({ path: '/old', Screen: Hidden });
