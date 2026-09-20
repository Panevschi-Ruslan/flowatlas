import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../environments/environment';

interface StreamParams {
  url: string;
  key: string;
}

/**
 * A wrapper that remembers what it was given before it opens anything.
 *
 * The shape a browser arrives at once a stream has to survive being
 * backgrounded: `connect` cannot open the stream there and then, so it keeps
 * its arguments and hands them to `open` later. The address is written two
 * calls away and passes through a field on the way, which is a hop further than
 * a wrapper handed the address whole (R21).
 *
 * Expected: no request of this class's own. Each caller of `connect` carries
 * the request it wrote.
 */
@Injectable({ providedIn: 'root' })
export class RememberedStreamService {
  private source: EventSource | null = null;
  private params: StreamParams | null = null;
  private readonly frames = new Subject<string>();

  readonly frames$: Observable<string> = this.frames.asObservable();

  connect(url: string, key: string): void {
    this.params = { url, key };
    this.open(this.params);
  }

  private open(p: StreamParams): void {
    const source = new EventSource(p.url);
    source.onmessage = (frame) => this.frames.next(frame.data as string);
    this.source = source;
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}

/**
 * One screen's stream, which is where the address is really decided.
 *
 * Expected: `ui_api_call` `GET /depots/:param/events`, `kind: "sse"`,
 * `meta.baseUrlEnv: "apiUrl"`, attributed here rather than to the wrapper, and
 * `hits` the route on `api`.
 */
@Injectable({ providedIn: 'root' })
export class OrderTrackStreamService {
  private readonly stream: RememberedStreamService;

  constructor(stream: RememberedStreamService) {
    this.stream = stream;
  }

  track(depotId: string, orderId: string): void {
    this.stream.connect(`${environment.apiUrl}/depots/${depotId}/events`, `${depotId}|${orderId}`);
  }
}
