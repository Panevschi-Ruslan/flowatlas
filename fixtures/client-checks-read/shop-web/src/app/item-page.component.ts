import { Component, type OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ItemsService, type Item, type ItemStats } from './items.service';

/**
 * `/items/:id`: the item and its counts asked for together, each held in a
 * member. The template checks `promo` and `badge` before it reads them, reads
 * `legacyCode` plainly, and switches over `status` with no `@default`.
 */
@Component({
  standalone: true,
  selector: 'app-item-page',
  template: `
    <h1>{{ item?.name }}</h1>
    <p>{{ item?.price }}</p>
    @if (item?.promo) {
      <p class="promo">{{ item.promo.text }}</p>
    }
    <span>{{ item?.badge?.label }}</span>
    <small>{{ item?.legacyCode }}</small>
    @switch (item?.status) {
      @case ('draft') { <em>Draft</em> }
      @case ('live') { <em>On sale</em> }
    }
    <p>{{ stats?.views }} views, {{ stats?.shares ?? 0 }} shares</p>
  `,
})
export class ItemPageComponent implements OnInit {
  item: Item | undefined;
  stats: ItemStats | undefined;

  constructor(private readonly items: ItemsService) {}

  ngOnInit(): void {
    forkJoin({ item: this.items.one('current'), stats: this.items.stats('current') }).subscribe(({ item, stats }) => {
      this.item = item;
      this.stats = stats;
    });
  }
}
