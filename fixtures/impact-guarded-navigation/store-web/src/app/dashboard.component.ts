import { Component, type OnInit } from '@angular/core';

import { ItemsClient } from './items.client';

/** `/dashboard`: loads the shop's items. The login screen and the role guard navigate here. */
@Component({
  standalone: true,
  selector: 'app-dashboard',
  template: `<ul>@for (item of items; track item) {<li>{{ item }}</li>}</ul>`,
})
export class DashboardComponent implements OnInit {
  items: string[] = [];

  constructor(private readonly client: ItemsClient) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.client.getItems('main').subscribe((items) => (this.items = items));
  }
}
