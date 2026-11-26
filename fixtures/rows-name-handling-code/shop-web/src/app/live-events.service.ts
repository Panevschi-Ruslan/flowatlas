import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../environments/environment';

export interface LiveEvent {
  type: string;
  deskNumber?: number;
}

/**
 * The web's one stream of the desks' alerts. Every frame is pushed into a
 * subject, and what subscribes to `stream$` chooses; the service chooses
 * nothing.
 */
@Injectable({ providedIn: 'root' })
export class LiveEvents {
  private readonly subject = new Subject<LiveEvent>();

  readonly stream$ = this.subject.asObservable();

  connect(): void {
    const source = new EventSource(`${environment.apiUrl}/api/events/stream`);
    source.onmessage = (m) => {
      const data = JSON.parse(m.data) as LiveEvent;
      this.subject.next(data);
    };
  }
}
