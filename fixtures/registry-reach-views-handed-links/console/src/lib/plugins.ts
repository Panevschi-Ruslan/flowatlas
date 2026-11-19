import type { ComponentType } from 'react';

/** One plugin: its address under the plugins, and its screen. */
export interface Plugin {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** The plugins installed, kept by the class. */
export class PluginRegistry {
  private static items: Plugin[] = [];

  static add(plugin: Plugin): void {
    this.items.push(plugin);
  }

  /** Each plugin at its address under the plugins. */
  static routes(): Plugin[] {
    return this.items.map((plugin) => ({ ...plugin, path: `/plugins${plugin.path}` }));
  }
}
