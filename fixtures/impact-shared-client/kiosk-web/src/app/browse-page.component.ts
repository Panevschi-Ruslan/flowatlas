import { Component, type OnInit } from '@angular/core';

import { KioskClient } from './kiosk.client';

/** `/browse`: requests `GET /api/items` through the kiosk's client. */
@Component({
  standalone: true,
  selector: 'app-browse-page',
  template: `<ul>@for (item of items; track item) {<li>{{ item }}</li>}</ul>`,
})
export class BrowsePageComponent implements OnInit {
  items: string[] = [];

  constructor(private readonly kiosk: KioskClient) {}

  ngOnInit(): void {
    this.kiosk.browse().subscribe((items) => (this.items = items));
  }
}
