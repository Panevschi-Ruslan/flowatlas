import { BadGatewayException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Whatever goes wrong behind it, the caller is told the catalogue did not answer. */
@Injectable()
export class UpstreamInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError(() => throwError(() => new BadGatewayException('the catalogue did not answer'))));
  }
}
