import { Hook, PluginManager, type Plugin } from '../utils/PluginManager';

/** The collection published as a getter, which is how the real one publishes it. */
export default class AuthenticationHelper {
  public static get providers(): Array<Plugin<Hook.AuthProvider>> {
    return PluginManager.getHooks(Hook.AuthProvider);
  }
}
