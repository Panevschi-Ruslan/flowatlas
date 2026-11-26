import { Component } from '@angular/core';

import { ItemsApiService } from './items-api.service';
import { ItemsLookupService } from './items-lookup.service';
import { PromoDialogComponent } from './promo-dialog.component';

/**
 * A child the catalog screen renders: its button requests the route through
 * the client, so the screen breaks if the route's handler does. It hands the
 * promotion dialog on as a value, which no template renders.
 */
@Component({
  selector: 'app-item-card',
  template: `<button (click)="load('42')">Load</button>`,
})
export class ItemCardComponent {
  readonly dialogs = [PromoDialogComponent];

  constructor(
    private readonly api: ItemsApiService,
    private readonly lookup: ItemsLookupService,
  ) {}

  load(id: string): void {
    this.api.one(id).subscribe();
  }
}
