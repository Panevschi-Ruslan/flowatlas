import { Component } from '@angular/core';

import { ItemsClient } from './items.client';

/** `/reports`: injects the client for `archive`, a request only the back end's catch-all answers. */
@Component({
  standalone: true,
  selector: 'app-reports-page',
  template: `<button (click)="archiveOld('7')">Archive</button>`,
})
export class ReportsPageComponent {
  constructor(private readonly client: ItemsClient) {}

  archiveOld(itemId: string): void {
    this.client.archive(itemId).subscribe();
  }
}
