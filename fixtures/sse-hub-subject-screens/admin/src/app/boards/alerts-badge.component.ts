import { Component, OnInit, inject } from '@angular/core';

import { AlertsStreamService } from '../live/alerts-stream.service';

/** Reached through the other instance of the generic stream: fed by the plain stream route alone. */
@Component({ selector: 'app-alerts-badge', standalone: true, template: '<span></span>' })
export class AlertsBadgeComponent implements OnInit {
  private readonly alerts = inject(AlertsStreamService);
  count = 0;

  ngOnInit(): void {
    this.alerts.connect('demo');
    this.alerts.alerts$.subscribe((evt) => {
      if (evt.type === 'CARD_ARCHIVED') this.bump();
    });
  }

  bump(): void {
    this.count += 1;
  }
}
