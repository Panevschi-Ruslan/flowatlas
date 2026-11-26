import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import type { Subscription } from 'rxjs';

import { CrewBoardStreamService } from '../live/crew-board-stream.service';

/** The types that make the crew panel refetch. */
const REFRESH_ON: ReadonlySet<string> = new Set(['CREW_ASSIGNED']);

/** Reached through one instance of the generic stream: fed by the crew route alone. */
@Component({ selector: 'app-crew-panel', standalone: true, template: '<aside></aside>' })
export class CrewPanelComponent implements OnInit, OnDestroy {
  private readonly stream = inject(CrewBoardStreamService);
  private streamSub: Subscription | null = null;
  refreshes = 0;

  ngOnInit(): void {
    this.stream.connect('demo', 'demo');
    this.streamSub = this.stream.events$.subscribe((evt) => {
      if (REFRESH_ON.has(evt.type)) this.scheduleRefresh();
    });
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
  }

  scheduleRefresh(): void {
    this.refreshes += 1;
  }
}
