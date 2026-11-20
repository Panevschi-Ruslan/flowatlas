import { Component, OnDestroy, OnInit } from '@angular/core';
import type { Subscription } from 'rxjs';

import { LiveUpdatesService } from '../live/live-updates.service';

/** A card's timeline: reached through another service's method, choosing by the type read in brackets. */
@Component({ selector: 'app-card-timeline', standalone: true, template: '<ol></ol>' })
export class CardTimelineComponent implements OnInit, OnDestroy {
  private sub: Subscription | null = null;
  entries = 0;

  constructor(private readonly live: LiveUpdatesService) {}

  ngOnInit(): void {
    this.sub = this.live.getCardUpdates().subscribe((event) => {
      if (event['type'] === 'CARD_ADDED') {
        this.append();
        return;
      }
      if (event['type'] === 'CARD_MOVED') this.reorder();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  append(): void {
    this.entries += 1;
  }

  reorder(): void {
    this.entries += 0;
  }
}
