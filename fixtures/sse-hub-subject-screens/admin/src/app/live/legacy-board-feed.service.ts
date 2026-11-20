import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../../environments/environment';
import type { BoardEvent } from './board-stream.service';

/**
 * The stream service the admin used before `BoardStreamService`: its subject
 * is public. Nothing injects it, so its stream is never opened and nothing
 * subscribed to it ever runs.
 */
@Injectable({ providedIn: 'root' })
export class LegacyBoardFeed {
  readonly events = new Subject<BoardEvent>();

  open(boardId: string): void {
    const source = new EventSource(`${environment.apiUrl}/api/boards/${boardId}/stream`);
    source.onmessage = (m) => this.events.next(JSON.parse(m.data) as BoardEvent);
  }
}
