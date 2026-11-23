import { Component } from '@angular/core';

import { ReportsClient } from './reports.client';

/** `/reports`: the daily report on load, and a button that exports. */
@Component({
  standalone: true,
  selector: 'app-reports',
  template: `<button (click)="exportAll()">Export</button>`,
})
export class ReportsComponent {
  total = 0;

  constructor(private readonly client: ReportsClient) {}

  ngOnInit(): void {
    this.client.daily().subscribe((rows) => (this.total = rows.length));
  }

  exportAll(): void {
    this.client.exportAll().subscribe();
  }
}
