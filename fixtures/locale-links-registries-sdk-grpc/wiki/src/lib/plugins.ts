import type { ComponentType } from 'react';

/** Where a plugin plugs in. */
export enum Hook {
  Settings = 'settings',
  Icon = 'icon',
}

/** One plugin's contribution to one hook. */
export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly type: Hook;
  readonly value: {
    readonly group?: string;
    readonly component: { readonly Component: ComponentType };
  };
}

/** Every plugin the wiki was built with, filed by the hook it plugs into. */
export class PluginManager {
  private static plugins = new Map<Hook, Plugin[]>();

  /** Adds one plugin, or several. */
  public static add(plugins: Plugin[] | Plugin) {
    if (Array.isArray(plugins)) {
      plugins.forEach((plugin) => this.register(plugin));
      return;
    }
    this.register(plugins);
  }

  private static register(plugin: Plugin) {
    if (!this.plugins.has(plugin.type)) this.plugins.set(plugin.type, []);
    this.plugins.get(plugin.type)!.push(plugin);
  }

  /** The plugins of one hook, in the order they were added. */
  public static getHooks(type: Hook): Plugin[] {
    return [...(this.plugins.get(type) ?? [])];
  }
}
