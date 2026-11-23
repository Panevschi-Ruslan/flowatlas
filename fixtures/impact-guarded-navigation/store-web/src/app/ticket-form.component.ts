import { Component } from '@angular/core';
import { Router } from '@angular/router';

/** Shown at two addresses; once a ticket is saved it navigates to the board, calling none of its code. */
@Component({
  standalone: true,
  selector: 'app-ticket-form',
  template: `<button (click)="submit()">Save</button>`,
})
export class TicketFormComponent {
  constructor(private readonly router: Router) {}

  submit(): void {
    void this.router.navigate(['/board']);
  }
}
