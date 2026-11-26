import { Component } from '@angular/core';
import { CatalogService } from './catalog.service';

/** `/catalog`: the grouped catalog, and a button that exports it. */
@Component({
  standalone: true,
  selector: 'app-catalog',
  template: `<button (click)="load()">Load</button><button (click)="download()">Export</button>`,
})
export class CatalogComponent {
  constructor(private readonly catalog: CatalogService) {}

  load(): void {
    this.catalog.getGrouped().subscribe();
  }

  download(): void {
    this.catalog.exportSheet().subscribe();
  }
}
