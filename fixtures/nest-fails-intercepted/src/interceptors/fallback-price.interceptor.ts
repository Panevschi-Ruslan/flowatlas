import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** A price that cannot be looked up is answered as zero: the request does not fail. */
@Injectable()
export class FallbackPriceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError(() => of({ price: 0 })));
  }
}
