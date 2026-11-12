import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Every request of the application's client goes to the catalog API's host,
 * under its `/api` mount, except the files the page serves itself.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('/assets/')) {
    return next(req);
  }
  return next(req.clone({ url: `https://catalog.example.test/api${req.url}` }));
};
