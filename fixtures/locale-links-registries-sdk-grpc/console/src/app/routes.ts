import { provideRouter, type Routes } from '@angular/router';

import { EditorComponent } from './editor.component.js';
import { leaveAdmin, signedIn, UnsavedChangesGuard } from './guards.js';

export const routes: Routes = [
  {
    path: 'admin',
    canDeactivate: [leaveAdmin],
    children: [{ path: 'editor', component: EditorComponent, canActivate: [signedIn], canDeactivate: [UnsavedChangesGuard] }],
  },
];

export const appConfig = { providers: [provideRouter(routes)] };
