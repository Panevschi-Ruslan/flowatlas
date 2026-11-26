import { Component, type OnInit } from '@angular/core';
import { filter } from 'rxjs';

import { ShopEventsService } from './shop-events.service';
import { StaffBoardService } from './staff-board.service';

/**
 * `/staff`: a click on a desk's alert, or an urgent call arriving on the
 * stream, reaches `ackCall` through two methods of its own.
 */
@Component({
  standalone: true,
  selector: 'app-staff-board',
  template: `@for (desk of desks; track desk) {<button (click)="onUrgency(desk)">{{ desk }}</button>}`,
})
export class StaffBoardComponent implements OnInit {
  desks: string[] = [];

  constructor(
    private readonly board: StaffBoardService,
    private readonly events: ShopEventsService,
  ) {}

  ngOnInit(): void {
    this.board.listDesks().subscribe((desks) => (this.desks = desks));
    this.events.connect('main');
    this.events.event$.pipe(filter((evt) => evt.type === 'DESK_URGENT')).subscribe((evt) => this.onUrgency(evt.deskId ?? ''));
  }

  onUrgency(deskId: string): void {
    this.routeAction(deskId, 'ack');
  }

  routeAction(deskId: string, action: string): void {
    if (action === 'ack') this.board.ackCall(deskId).subscribe();
  }
}
