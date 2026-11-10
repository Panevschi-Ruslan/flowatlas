import type { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Every request of the admin's client goes under the API address its environment gives. */
export const baseInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: environment.apiUrl + req.url }));
