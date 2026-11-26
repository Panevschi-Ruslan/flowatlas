import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../../environments/environment';

export interface DeskEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * The staff screens' one stream of a tenant's events. Every frame is pushed
 * into a subject, and the screens subscribe to what the service exposes of
 * it; the service itself chooses nothing.
 */
@Injectable({ providedIn: 'root' })
export class DeskStreamService {
  private source: EventSource | null = null;
  private readonly _event$ = new Subject<DeskEvent>();

  readonly event$ = this._event$.asObservable();

  connect(tenantId: string): void {
    this.source?.close();
    this.source = new EventSource(`${environment.apiUrl}/api/${tenantId}/stream`);
    this.source.onmessage = (m) => {
      const data = JSON.parse(m.data) as DeskEvent;
      this._event$.next(data);
    };
  }
}
