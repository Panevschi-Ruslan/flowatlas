import { Injectable } from '@angular/core';

/** The figures the reports screen shows. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  totals(): number {
    return Number(sessionStorage.getItem('totals') ?? 0);
  }
}
