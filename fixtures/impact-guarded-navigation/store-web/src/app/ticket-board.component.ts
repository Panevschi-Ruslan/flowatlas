import { Component } from '@angular/core';

import { TicketBoardService } from './ticket-board.service';

/** `/board`: a click on a ticket reaches `acknowledge` through a method of its own. */
@Component({
  standalone: true,
  selector: 'app-ticket-board',
  template: `@for (ticket of tickets; track ticket) {<button (click)="resolve(ticket)">{{ ticket }}</button>}`,
})
export class TicketBoardComponent {
  tickets: string[] = ['1', '2'];

  constructor(private readonly board: TicketBoardService) {}

  resolve(ticketId: string): void {
    this.routeAction(ticketId, 'ack');
  }

  routeAction(ticketId: string, action: string): void {
    if (action === 'ack') this.board.acknowledge(ticketId).subscribe();
  }
}
