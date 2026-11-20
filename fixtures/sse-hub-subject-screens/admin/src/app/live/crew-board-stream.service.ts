import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { LiveStream } from './live-stream';

export interface CrewEvent {
  type: string;
  crewId?: string;
}

export const PLATFORM_ID = new InjectionToken<object>('platform');

/** The crew board's stream: one instance of the generic stream, handed the crew route. */
@Injectable({ providedIn: 'root' })
export class CrewBoardStreamService {
  private readonly stream = new LiveStream<CrewEvent>(inject(PLATFORM_ID));
  private readonly base = environment.apiUrl;
  readonly events$: Observable<CrewEvent> = this.stream.events$;

  connect(boardId: string, token: string): void {
    this.stream.connect(`${this.base}/api/boards/${boardId}/crew/stream?token=${token}`, `crew:${boardId}`, (f) => f.message as CrewEvent);
  }
}
