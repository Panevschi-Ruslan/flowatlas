import { Component } from '@angular/core';
import { Router } from '@angular/router';

/** `/tickets/:ticketId`: closing a ticket goes back to the board by its address. */
@Component({
  standalone: true,
  selector: 'app-ticket-detail',
  template: `<button (click)="close()">Close</button>`,
})
export class TicketDetailComponent {
  constructor(private readonly router: Router) {}

  close(): void {
    void this.router.navigateByUrl('/board');
  }
}
