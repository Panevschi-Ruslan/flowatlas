import { loadScreen } from '../../../lib/load-screen';
import { Hook, PluginManager } from '../../../lib/plugins';
import config from '../plugin.json';

// A workspace screen: its settings sit under `/settings/<id>`.
PluginManager.add({
  ...config,
  type: Hook.Settings,
  value: {
    group: 'Workspace',
    component: loadScreen(() => import('./Settings')),
  },
});
