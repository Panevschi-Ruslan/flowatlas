import { NgModule } from '@angular/core';

import { AuthService } from './auth.service';
import { LegacyPanelComponent } from './legacy-panel.component';
import { OrdersListComponent } from './orders-list.component';
import { SharedModule } from './shared.module';

/** A module that declares two components, which is what makes them not standalone. */
@NgModule({
  declarations: [OrdersListComponent, LegacyPanelComponent],
  imports: [SharedModule],
  providers: [AuthService],
})
export class OrdersModule {}
