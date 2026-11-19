import type { HttpInterceptorFn } from '@angular/common/http';

/** Puts the session token on every request; the address is left as it is. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');
  return next(req.clone({ setHeaders: token ? { Authorization: `Bearer ${token}` } : {} }));
};
