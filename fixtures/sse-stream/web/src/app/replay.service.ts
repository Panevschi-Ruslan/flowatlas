import { Injectable } from '@angular/core';

/** A stream client of this application's own, sharing the name and nothing else. */
export class EventSource {
  constructor(readonly frames: readonly string[]) {}

  replay(): string | undefined {
    return this.frames[0];
  }
}

/**
 * The name on its own proves nothing.
 *
 * A class declared here is not the browser's client however it is spelled, so
 * this must produce no request at all — and silently, because there is no stream
 * to have missed.
 */
@Injectable({ providedIn: 'root' })
export class ReplayService {
  // Expected: nothing.
  open(frames: readonly string[]): EventSource {
    return new EventSource(frames);
  }
}
