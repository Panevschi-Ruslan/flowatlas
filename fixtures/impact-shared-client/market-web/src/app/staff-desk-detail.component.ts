import { Component } from '@angular/core';

import { StaffBoardService } from './staff-board.service';

/** `/staff/desks/:deskId`: injects the staff client for `close` only. */
@Component({
  standalone: true,
  selector: 'app-staff-desk-detail',
  template: `<button (click)="closeDesk('1')">Close</button>`,
})
export class StaffDeskDetailComponent {
  constructor(private readonly board: StaffBoardService) {}

  closeDesk(deskId: string): void {
    this.board.close(deskId).subscribe();
  }
}
