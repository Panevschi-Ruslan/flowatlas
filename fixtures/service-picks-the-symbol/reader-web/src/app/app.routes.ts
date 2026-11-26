import type { Routes } from '@angular/router';

import { BookPageComponent } from './book-page.component';
import { ShelfPageComponent } from './shelf-page.component';

export const routes: Routes = [
  { path: 'book/:bookId', component: BookPageComponent },
  { path: 'shelf', component: ShelfPageComponent },
];
