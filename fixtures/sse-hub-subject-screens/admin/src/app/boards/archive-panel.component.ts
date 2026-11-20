import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import type { Subscription } from 'rxjs';

import { BoardStreamService } from '../live/board-stream.service';

/** The cards it counts as archived: a constant list the callback tests the type against. */
const ARCHIVE_TYPES = ['CARD_ARCHIVED'] as const;

/** Refreshes the archive when a card is archived: chosen in the callback, by a list. */
@Component({ selector: 'app-archive-panel', standalone: true, template: '<aside></aside>' })
export class ArchivePanelComponent implements OnInit, OnDestroy {
  private readonly stream = inject(BoardStreamService);
  private sub: Subscription | null = null;
  archived = 0;

  ngOnInit(): void {
    this.sub = this.stream.event$.subscribe((evt) => {
      if ((ARCHIVE_TYPES as readonly string[]).includes(evt.type)) this.refreshArchive();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  refreshArchive(): void {
    this.archived += 1;
  }
}
