import { Component } from '@angular/core';

import { ProductsClient } from './products.client';

/** `/catalog`: the products, listed when the screen opens, and a button adding one. */
@Component({
  standalone: true,
  selector: 'app-catalog',
  template: `<p>{{ skus.length }}</p><button (click)="add()">Add</button>`,
})
export class CatalogComponent {
  skus: string[] = [];

  constructor(private readonly products: ProductsClient) {}

  ngOnInit(): void {
    this.products.list().subscribe((skus) => (this.skus = skus));
  }

  add(): void {
    this.products.create({ sku: 'new', name: 'New', price: 1 }).subscribe();
  }
}
