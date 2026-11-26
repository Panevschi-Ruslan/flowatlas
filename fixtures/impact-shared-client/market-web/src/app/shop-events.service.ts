import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../environments/environment';

export interface ShopEvent {
  type: string;
  deskId?: string;
}

/** The one stream of a shop's events: screens subscribe to what it exposes and choose by type. */
@Injectable({ providedIn: 'root' })
export class ShopEventsService {
  private source: EventSource | null = null;
  private readonly _event$ = new Subject<ShopEvent>();

  readonly event$ = this._event$.asObservable();

  connect(shopId: string): void {
    this.source?.close();
    this.source = new EventSource(`${environment.apiUrl}/api/shops/${shopId}/events`);
    this.source.onmessage = (m) => this._event$.next(JSON.parse(m.data) as ShopEvent);
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}
