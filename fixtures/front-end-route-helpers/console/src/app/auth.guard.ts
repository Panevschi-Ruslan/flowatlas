import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

/** Lets a signed-in visitor through, and sends anyone else to the login screen. */
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  return localStorage.getItem('session') !== null ? true : router.createUrlTree(['/login']);
};

/** Sends a visitor whose session ended back to the start, by its address. */
export function endedGuard() {
  return inject(Router).parseUrl('/');
}
