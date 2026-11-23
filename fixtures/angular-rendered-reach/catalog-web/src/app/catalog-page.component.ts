import { Component } from '@angular/core';

/** The screen at `/catalog`: it renders the item card by its tag, and nothing else reaches the card. */
@Component({
  selector: 'app-catalog-page',
  template: `
    <h1>Catalog</h1>
    <app-item-card></app-item-card>
  `,
})
export class CatalogPageComponent {}
