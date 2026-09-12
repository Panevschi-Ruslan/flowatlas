import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../environments/environment';

export interface LiveEvent {
  type: string;
  orderId?: string;
}

/**
 * The stream R15 was written from.
 *
 * The address is served by a route declared in the worker, not by a controller.
 * Before R15 this was reported as drift — "the service has no such route" —
 * about a service that serves it.
 */
@Injectable({ providedIn: 'root' })
export class LiveEventsService {
  private source: EventSource | null = null;
  private readonly events = new Subject<LiveEvent>();

  readonly events$: Observable<LiveEvent> = this.events.asObservable();

  open(depotId: string): void {
    const url = `${environment.apiUrl}/depots/${depotId}/stream`;
    const source = new EventSource(url);
    source.onmessage = (frame) => this.events.next(JSON.parse(frame.data) as LiveEvent);
    this.source = source;
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
