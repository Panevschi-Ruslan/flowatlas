import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Hands every error to a method that decides what it becomes: nothing here can read which. */
@Injectable()
export class TranslateInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((err) => this.translate(err)));
  }

  private translate(err: unknown): Observable<never> {
    return throwError(() => (err instanceof HttpException ? err : new HttpException('stats failed', 500)));
  }
}
