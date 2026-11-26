import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from './auth.service';

/** Lets a signed-in visitor through, and sends anyone else to the login screen. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isSignedIn() ? true : router.createUrlTree(['/login']);
};

/** Lets a manager through, and sends anyone else back to the dashboard. */
export const roleGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.role() === 'manager') return true;
  void router.navigate(['/dashboard']);
  return false;
};
