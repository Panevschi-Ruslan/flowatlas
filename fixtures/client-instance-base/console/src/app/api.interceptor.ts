import type { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../environments/environment';

/** Every request the client makes goes out under the API's address, unless it names a host of its own. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('http')) return next(req);
  return next(req.clone({ url: `${environment.apiUrl}${req.url}` }));
};
