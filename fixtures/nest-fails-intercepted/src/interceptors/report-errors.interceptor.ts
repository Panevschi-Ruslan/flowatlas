import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ReportUnavailable } from '../errors';

/** Keeps the framework's own exceptions; everything else is a report that is not available. */
@Injectable()
export class ReportErrorsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((err) => (err instanceof HttpException ? throwError(() => err) : throwError(() => new ReportUnavailable()))));
  }
}
