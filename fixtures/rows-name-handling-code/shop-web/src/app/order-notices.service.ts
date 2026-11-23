import { Injectable } from '@angular/core';
import { filter } from 'rxjs';

import { LiveEvents, type LiveEvent } from './live-events.service';
import { Toast } from './toast.service';

/**
 * Toasts on a desk's call for help. Nothing injects it and nothing calls
 * `initialize`, so its subscription is never made: its handler never runs,
 * whoever else calls the toast.
 */
@Injectable({ providedIn: 'root' })
export class OrderNotices {
  constructor(
    private readonly events: LiveEvents,
    private readonly toast: Toast,
  ) {}

  initialize(): void {
    this.events.stream$.pipe(filter((event) => event !== null)).subscribe((event) => {
      this.handle(event);
    });
  }

  private handle(event: LiveEvent): void {
    if (event.type === 'HELP_REQUESTED') {
      this.toast.showInfo(`Desk ${event.deskNumber} needs help`);
      return;
    }
  }
}
