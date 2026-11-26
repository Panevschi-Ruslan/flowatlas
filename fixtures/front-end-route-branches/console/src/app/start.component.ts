import { Component } from '@angular/core';
import { Router } from '@angular/router';

/** The start screen: two ways to the reports, one by its route and one by its address with a range. */
@Component({
  selector: 'app-start',
  template: `<button (click)="openReports()">Reports</button><button (click)="openWeek()">This week</button>`,
})
export class StartComponent {
  constructor(private readonly router: Router) {}

  openReports(): void {
    this.router.navigate(['/reports']);
  }

  openWeek(): void {
    this.router.navigateByUrl('/reports?range=week');
    this.router.navigate(['/reports']);
  }
}
