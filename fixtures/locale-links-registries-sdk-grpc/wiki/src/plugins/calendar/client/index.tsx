import { loadScreen } from '../../../lib/load-screen';
import { Hook, PluginManager } from '../../../lib/plugins';
import config from '../plugin.json';

// An integration: its settings sit under `/settings/integrations/<id>`.
PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      component: loadScreen(() => import('./Settings')),
    },
  },
]);
