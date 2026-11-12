import type { ComponentType } from 'react';
import { installed } from '../lib/extensions';
import { loadScreen } from '../lib/load-screen';
import { settingsPath } from '../lib/paths';
import { useMemoized } from './useMemoized';

const Profile = loadScreen(() => import('../screens/settings/Profile'));
const Members = loadScreen(() => import('../screens/settings/Members'));
const Webhooks = loadScreen(() => import('../screens/settings/Webhooks'));

/** One settings screen: its name in the menu, its address and what it shows. */
export interface SettingsEntry {
  readonly name: string;
  readonly path: string;
  readonly component: ComponentType;
  readonly enabled: boolean;
}

/** Every settings screen the visitor may open, the menu and the routes alike. */
export default function useSettingsEntries(canManage: boolean): SettingsEntry[] {
  const entries = useMemoized(() => {
    const items: SettingsEntry[] = [
      { name: 'Profile', path: settingsPath(), component: Profile.Component, enabled: true },
      { name: 'Members', path: settingsPath('members'), component: Members.Component, enabled: canManage },
    ];
    for (const extension of installed) {
      items.splice(1, 0, { name: extension.name, path: settingsPath(extension.id), component: extension.component, enabled: true });
    }
    items.push({ name: 'Webhooks', path: settingsPath('webhooks'), component: Webhooks.Component, enabled: canManage });
    return items;
  });
  return entries.filter((entry) => entry.enabled);
}
