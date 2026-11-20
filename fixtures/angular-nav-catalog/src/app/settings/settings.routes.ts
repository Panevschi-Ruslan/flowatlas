import type { Routes } from '@angular/router';

import { ProfileComponent } from './profile.component';

/** Mounted under `/settings` by the root's `loadChildren`. */
export default [{ path: 'profile', component: ProfileComponent }] satisfies Routes;
