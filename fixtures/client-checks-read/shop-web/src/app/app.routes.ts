import type { Routes } from '@angular/router';

import { ItemPageComponent } from './item-page.component';

export const routes: Routes = [{ path: 'items/:id', component: ItemPageComponent }];
