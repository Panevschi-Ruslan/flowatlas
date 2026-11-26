import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * The back office's requests go under `/office-rest`, the rest under
 * `/store-rest`; a file the page serves itself is sent on as it is.
 */
export const prefixInterceptor: HttpInterceptorFn = (req, next) => {
  const base = req.url.includes('admin') ? '/office-rest' : '/store-rest';
  return next(req.clone({ url: req.url.startsWith('/assets/') ? req.url : base + req.url }));
};
