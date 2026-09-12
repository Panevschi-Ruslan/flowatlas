import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../environments/environment';

export interface LiveEvent {
  type: string;
  depotId: string;
  orderId?: string;
}

/**
 * The browser's end of the stream.
 *
 * Nothing here names a channel: the address is all there is. So a subscription is
 * read as what it is — one `GET`, held open — and joined to the route that serves
 * it, exactly as an ordinary request is.
 */
@Injectable({ providedIn: 'root' })
export class LiveEventsService {
  private source: EventSource | null = null;
  private readonly events = new Subject<LiveEvent>();

  readonly events$: Observable<LiveEvent> = this.events.asObservable();

  // Expected: `ui_api_call` `GET /depots/:param/events`, `kind: "sse"`,
  // `meta.baseUrlEnv: "apiUrl"`, `hits` the route on `api` via `api-target`, static.
  open(depotId: string): void {
    const url = `${environment.apiUrl}/depots/${depotId}/events`;
    const source = new EventSource(url);
    source.onmessage = (frame) => this.events.next(JSON.parse(frame.data) as LiveEvent);
    this.source = source;
  }

  /**
   * The same stream, with credentials in the query string because the client
   * cannot set headers — which is how every one of these is written in practice.
   *
   * Expected: `ui_api_call` with `path` ending in a hole, counted under
   * `api-path-partly-read` and joined to nothing. The query is not part of the
   * route, but a `+` whose right-hand side cannot be read collapses whole, taking
   * the `?` with it, so nothing is left to cut the path at. That is the address
   * reader's, not this pass's: see the R08 log.
   */
  openWithToken(depotId: string, token: string): void {
    const url =
      `${environment.apiUrl}/depots/${depotId}/events` +
      `?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    source.onmessage = (frame) => this.events.next(JSON.parse(frame.data) as LiveEvent);
    this.source = source;
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
