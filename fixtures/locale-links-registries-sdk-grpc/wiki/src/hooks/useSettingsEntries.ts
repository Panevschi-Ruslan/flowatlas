import type { ComponentType } from 'react';
import { useMemo } from 'react';
import { loadScreen } from '../lib/load-screen';
import { integrationPath, settingsPath } from '../lib/paths';
import { Hook, PluginManager } from '../lib/plugins';

const Profile = loadScreen(() => import('../screens/settings/Profile'));

/** One settings screen: its address and what it shows. */
export interface SettingsEntry {
  readonly path: string;
  readonly component: ComponentType;
}

/** Every settings screen: the wiki's own, then one per plugin that adds one. */
export default function useSettingsEntries(): SettingsEntry[] {
  return useMemo(() => {
    const items: SettingsEntry[] = [{ path: settingsPath(), component: Profile.Component }];
    PluginManager.getHooks(Hook.Settings).forEach((plugin) => {
      const group = plugin.value.group ?? 'Integrations';
      items.splice(items.length, 0, {
        path: group === 'Integrations' ? integrationPath(plugin.id) : settingsPath(plugin.id),
        component: plugin.value.component.Component,
      });
    });
    return items;
  }, []);
}
