import { Component, type OnInit } from '@angular/core';
import { filter } from 'rxjs';

import { ItemsClient } from './items.client';
import { ShopEventsService } from './shop-events.service';

/** `/history`: the one screen calling `ItemsClient.getHistory`, on open and again when the shop's items change. */
@Component({
  standalone: true,
  selector: 'app-history-page',
  template: `<ul>@for (item of items; track item) {<li>{{ item }}</li>}</ul>`,
})
export class HistoryPageComponent implements OnInit {
  items: string[] = [];

  constructor(
    private readonly client: ItemsClient,
    private readonly events: ShopEventsService,
  ) {}

  ngOnInit(): void {
    this.refresh();
    this.events.connect('main');
    this.events.event$.pipe(filter((evt) => evt.type === 'ITEMS_CHANGED')).subscribe(() => this.refresh());
  }

  refresh(): void {
    this.client.getHistory('main').subscribe((items) => (this.items = items));
  }
}
