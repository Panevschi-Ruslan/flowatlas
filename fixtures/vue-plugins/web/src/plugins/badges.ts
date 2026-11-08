import type { App } from 'vue';

import AppBadge from '../components/AppBadge.vue';

/** A plugin of the application's own: what it registers is read where it registers it. */
export const badges = {
  install(app: App): void {
    app.component('AppBadge', AppBadge);
  },
};
