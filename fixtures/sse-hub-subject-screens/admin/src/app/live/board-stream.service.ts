import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../../environments/environment';

export interface BoardEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * The admin's one stream of a board's events. Every frame is pushed into a
 * subject, and the screens subscribe to what the service exposes of it; the
 * service itself chooses nothing.
 */
@Injectable({ providedIn: 'root' })
export class BoardStreamService {
  private source: EventSource | null = null;
  private readonly _event$ = new Subject<BoardEvent>();

  readonly event$ = this._event$.asObservable();

  connect(boardId: string, token: string): void {
    this.close();
    this.openStream(boardId, token);
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }

  private openStream(boardId: string, token: string): void {
    this.source = new EventSource(`${environment.apiUrl}/api/boards/${boardId}/events?token=${encodeURIComponent(token)}`);
    this.source.onmessage = (m) => {
      const data = JSON.parse(m.data) as BoardEvent;
      this._event$.next(data);
    };
  }
}
