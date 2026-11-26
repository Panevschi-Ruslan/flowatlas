import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, filter, takeUntil } from 'rxjs';

import { BoardStreamService } from '../live/board-stream.service';

/** Reloads the board when a card moves or one is added: chosen in the pipe, before the callback. */
@Component({ selector: 'app-board-page', standalone: true, template: '<section></section>' })
export class BoardPageComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  boardId = 'demo';

  constructor(private readonly stream: BoardStreamService) {}

  ngOnInit(): void {
    this.stream.connect(this.boardId, 'demo');
    this.stream.event$
      .pipe(
        filter((evt) => evt.type === 'CARD_MOVED' || evt.type === 'CARD_ADDED'),
        takeUntil(this.destroyed$),
      )
      .subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  load(): void {
    void this.boardId;
  }
}
