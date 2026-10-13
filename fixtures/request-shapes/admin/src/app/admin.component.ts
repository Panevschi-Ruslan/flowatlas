import { Component } from '@angular/core';
import { AdminApiService } from './admin-api.service';

/** One button per request, so each is reached from a screen. */
@Component({
  selector: 'app-admin',
  standalone: true,
  template: `
    <button (click)="place()">Place</button>
    <button (click)="importBatch()">Import</button>
    <button (click)="load()">Load</button>
    <button (click)="item()">Item</button>
  `,
})
export class AdminComponent {
  constructor(private readonly api: AdminApiService) {}

  place(): void {
    this.api.place({ total: 12 }).subscribe();
  }

  importBatch(): void {
    this.api.importBatch({ source: 'csv' }).subscribe();
  }

  load(): void {
    this.api.orders().subscribe();
  }

  item(): void {
    this.api.item('i1').subscribe();
  }
}
