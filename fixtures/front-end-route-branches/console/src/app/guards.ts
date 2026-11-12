import { inject } from '@angular/core';
import { ReportsService } from './reports.service.js';
import { SessionService } from './session.service.js';

/** Lets a signed-in visitor through, and turns anyone else away without sending them anywhere. */
export const requireSession = () => {
  const session = inject(SessionService);
  return session.isSignedIn();
};

/** A guard for one role, made by the route that lists it. */
export const roleGuard = (role: string) => () => inject(SessionService).hasRole(role);

/** The totals the reports screen opens with, fetched before it is shown. */
export const totalsResolver = () => inject(ReportsService).totals();
