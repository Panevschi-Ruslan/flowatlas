import { Hook, PluginManager } from '../../../utils/PluginManager';
import api from './api/passkeys';
import router from './auth/passkeys';

/**
 * One plugin registering four things, two of which are ways in.
 *
 * The API router sits at `value` and the authentication router at
 * `value.router`, in the same registry, and the two mounts that install them
 * read those two paths. Nothing here says which mount will take which: the keys
 * do.
 */
PluginManager.add([
  {
    name: 'passkeys',
    type: Hook.API,
    value: api,
  },
  {
    name: 'passkeys',
    type: Hook.AuthProvider,
    value: { router, id: 'passkeys' },
  },
  {
    type: Hook.Task,
    value: () => undefined,
  },
]);
