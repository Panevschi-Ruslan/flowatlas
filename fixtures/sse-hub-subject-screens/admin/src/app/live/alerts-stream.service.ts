import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { PLATFORM_ID } from './crew-board-stream.service';
import { LiveStream } from './live-stream';

export interface AlertEvent {
  type: string;
}

/** Another instance of the generic stream, handed the board's plain stream route. */
@Injectable({ providedIn: 'root' })
export class AlertsStreamService {
  private readonly stream = new LiveStream<AlertEvent>(inject(PLATFORM_ID));
  readonly alerts$: Observable<AlertEvent> = this.stream.events$;

  connect(boardId: string): void {
    this.stream.connect(`${environment.apiUrl}/api/boards/${boardId}/stream`, `alerts:${boardId}`, (f) => f.message as AlertEvent);
  }
}
