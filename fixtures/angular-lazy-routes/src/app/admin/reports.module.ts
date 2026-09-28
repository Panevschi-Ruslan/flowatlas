import { NgModule } from '@angular/core';
import { RouterModule, type Routes } from '@angular/router';

import { ReportsComponent } from './reports.component';

/** The older shape of a lazy file: the routes are handed to `forChild`. */
const routes: Routes = [{ path: 'weekly', component: ReportsComponent }];

@NgModule({ imports: [RouterModule.forChild(routes)] })
export class ReportsModule {}
