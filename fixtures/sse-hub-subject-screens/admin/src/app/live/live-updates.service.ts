import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { BoardStreamService, type BoardEvent } from './board-stream.service';

export interface CardEvent extends BoardEvent {
  cardId: string;
}

/** Re-exposes the board's stream to the card screens, cast to the cards' own type. */
@Injectable({ providedIn: 'root' })
export class LiveUpdatesService {
  private readonly stream = inject(BoardStreamService);

  getCardUpdates(): Observable<CardEvent> {
    return this.stream.event$ as Observable<CardEvent>;
  }
}
