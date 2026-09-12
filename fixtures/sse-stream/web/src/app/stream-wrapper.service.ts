import { Injectable } from '@angular/core';

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

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
