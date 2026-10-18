import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

/** Logs how long a request took, and hands every error on as it was. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    return next.handle().pipe(
      tap(() => console.log(`answered in ${Date.now() - started} ms`)),
      catchError((error) => {
        console.warn(`failed after ${Date.now() - started} ms`);
        return throwError(() => error);
      }),
    );
  }
}
