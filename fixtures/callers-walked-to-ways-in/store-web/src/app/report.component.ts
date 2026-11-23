import { Component } from '@angular/core';

import { StoreClient } from './store.client';

/** `/reports`: the daily report, read when the screen opens. */
@Component({
  standalone: true,
  selector: 'app-report',
  template: `<p>{{ lines.length }}</p>`,
})
export class ReportComponent {
  lines: string[] = [];

  constructor(private readonly client: StoreClient) {}

  ngOnInit(): void {
    this.client.daily().subscribe((lines) => (this.lines = lines));
  }
}
