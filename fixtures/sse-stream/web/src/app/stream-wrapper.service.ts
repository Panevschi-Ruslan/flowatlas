import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

/**
 * A wrapper handed a finished address.
 *
 * The shape every browser application ends up with once more than one screen
 * needs a stream, and the one the address cannot be read at: it was written a
 * call further away. Reported rather than guessed at.
 */
@Injectable({ providedIn: 'root' })
export class StreamWrapperService {
  private source: EventSource | null = null;

  // Expected: `ui_api_call` with `path: null`, `calls` edge heuristic, and
  // unresolved `api-path-dynamic` naming the annotation that would fix it.
  open(url: string): void {
    this.source = new EventSource(url);
  }

  /**
   * The same wrapper written as a field, which is how one gets handed to a
   * callback and keeps its `this`. Its parameters sit on the arrow and its
   * callers name a property, so following it means asking both questions one
   * node deeper (R26).
   *
   * Expected: no request of its own. `WatchService.watch` carries it.
   */
  openLater = (url: string): void => {
    this.source = new EventSource(url);
  };

  close(): void {
    this.source?.close();
    this.source = null;
  }
}

/** Where the address is decided for the wrapper written as a field. */
@Injectable({ providedIn: 'root' })
export class WatchService {
  constructor(private readonly streams: StreamWrapperService) {}

  watch(depotId: string): void {
    this.streams.openLater(`${environment.apiUrl}/depots/${depotId}/events`);
  }
}
