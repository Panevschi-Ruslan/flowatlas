import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { BookNotFound, StockExhausted } from '../errors';

/** Turns the shop's own errors into the framework's; hands every other error on. */
@Injectable()
export class StockInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err) => {
        if (err instanceof StockExhausted) {
          return throwError(() => new ConflictException('out of stock'));
        }
        if (err instanceof BookNotFound) throw new NotFoundException('no such book');
        return throwError(() => err);
      }),
    );
  }
}
