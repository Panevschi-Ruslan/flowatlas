import { Component, type OnDestroy } from '@angular/core';

import { ItemsClient } from './items.client';
import { ShopEventsService } from './shop-events.service';

/**
 * `/catalog`: injects the items client for `create`, whose route publishes
 * the change the history screen reacts to, and the stream for `disconnect`
 * alone: it never opens one.
 */
@Component({
  standalone: true,
  selector: 'app-catalog-page',
  template: `<button (click)="add('lamp')">Add</button>`,
})
export class CatalogPageComponent implements OnDestroy {
  constructor(
    private readonly client: ItemsClient,
    private readonly events: ShopEventsService,
  ) {}

  add(name: string): void {
    this.client.create('main', name).subscribe();
  }

  ngOnDestroy(): void {
    this.events.disconnect();
  }
}
