import { Component } from '@angular/core';

import { ProductsClient } from './products.client';

/** `/catalog/:sku`: one product, read when the screen opens, renamed on save. */
@Component({
  standalone: true,
  selector: 'app-product-edit',
  template: `<input [value]="name" /><button (click)="save()">Save</button>`,
})
export class ProductEditComponent {
  sku = 'basket';
  name = '';

  constructor(private readonly products: ProductsClient) {}

  ngOnInit(): void {
    this.products.one(this.sku).subscribe((name) => (this.name = name));
  }

  save(): void {
    this.products.update(this.sku, this.name).subscribe();
  }
}
