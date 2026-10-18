import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Refuses a request over the quota before the handler runs; leaves errors alone. */
@Injectable()
export class QuotaInterceptor implements NestInterceptor {
  private used = 0;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.used += 1;
    if (this.used > 1000) throw new HttpException('quota used up', 429);
    return next.handle();
  }
}
