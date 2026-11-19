import { loadScreen } from '../../../lib/load-screen';
import { Hook, PluginManager } from '../../../lib/plugins';
import config from '../plugin.json';

// Plugs into another hook: no settings screen of its own.
PluginManager.add([
  {
    ...config,
    type: Hook.Icon,
    value: {
      component: loadScreen(() => import('./Settings')),
    },
  },
]);
