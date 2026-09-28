import type { Router } from '@koa/router';

/** The kinds of thing a plugin may register, of which one is a way in. */
export enum Hook {
  API = 'api',
  AuthProvider = 'authProvider',
  Task = 'task',
}

/**
 * What each kind registers, which is a different thing per kind.
 *
 * An API plugin registers a router; an authentication provider registers a
 * router and the id it is known by. Both hold a router and they hold it in
 * different places, which is why the keys a mount reads are what tell the two
 * apart rather than the `type` written beside them.
 */
type PluginValueMap = {
  [Hook.API]: Router;
  [Hook.AuthProvider]: { router: Router; id: string };
  [Hook.Task]: () => void;
};

export type Plugin<T extends Hook> = {
  type: T;
  name?: string;
  value: PluginValueMap[T];
};

/**
 * A registry of plugins, loaded from disk at start-up.
 *
 * Nothing imports the plugins: the real one globs `plugins/<name>/server/index`
 * and requires each match, so there is no import edge anywhere from the
 * application to a plugin. What there is, in every one of those files, is a call
 * on this class handing over what the plugin registers — which is what makes the
 * collection followable at all, and the only thing that does.
 */
export class PluginManager {
  private static plugins = new Map<Hook, Array<Plugin<Hook>>>();

  public static add(plugins: Array<Plugin<Hook>> | Plugin<Hook>): void {
    const many = Array.isArray(plugins) ? plugins : [plugins];
    for (const plugin of many) {
      const held = PluginManager.plugins.get(plugin.type) ?? [];
      held.push(plugin);
      PluginManager.plugins.set(plugin.type, held);
    }
  }

  public static getHooks<T extends Hook>(type: T): Array<Plugin<T>> {
    return (PluginManager.plugins.get(type) ?? []) as Array<Plugin<T>>;
  }
}
