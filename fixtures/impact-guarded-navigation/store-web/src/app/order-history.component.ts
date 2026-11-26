import { Component, type OnInit } from '@angular/core';

import { ItemsClient } from './items.client';

/** `/history`: the other screen loading the shop's items. */
@Component({
  standalone: true,
  selector: 'app-order-history',
  template: `<ol>@for (item of items; track item) {<li>{{ item }}</li>}</ol>`,
})
export class OrderHistoryComponent implements OnInit {
  items: string[] = [];

  constructor(private readonly client: ItemsClient) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.client.getItems('main').subscribe((items) => (this.items = items));
  }
}
