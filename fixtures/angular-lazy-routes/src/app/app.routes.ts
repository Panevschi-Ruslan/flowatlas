import type { Routes } from '@angular/router';

import { HomeComponent } from './home.component';
import { ShellComponent } from './shell.component';

/**
 * A root written as a default export, with no annotation on the array.
 *
 * The annotation is optional in the language, and 21 of a video platform's 31 route
 * files leave it off, so what identifies this as a configuration is what is in
 * it (R104). The `admin` route loads its children rather than naming them.
 */
const routes = [
  { path: '', component: ShellComponent },
  { path: 'home', component: HomeComponent },
  { path: 'admin', loadChildren: () => import('./admin/routes') },
] satisfies Routes;

export default routes;
