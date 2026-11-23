import { Component, type OnInit } from '@angular/core';

import { StaffBoardService } from './staff-board.service';

/**
 * Shown at three addresses; injects the staff client for `listDesks` and
 * `callStaff`, whose route publishes the urgent call the board reacts to.
 */
@Component({
  standalone: true,
  selector: 'app-staff-order',
  template: `<button (click)="callStaff('1')">Call staff</button>`,
})
export class StaffOrderComponent implements OnInit {
  desks: string[] = [];

  constructor(private readonly board: StaffBoardService) {}

  ngOnInit(): void {
    this.board.listDesks().subscribe((desks) => (this.desks = desks));
  }

  callStaff(deskId: string): void {
    this.board.callStaff(deskId).subscribe();
  }
}
