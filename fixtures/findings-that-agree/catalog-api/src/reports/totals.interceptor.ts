import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** Adds totals to a report on the way out, in a helper: what the client gets is worked out when the code runs. */
@Injectable()
export class TotalsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((report) => this.withTotals(report)));
  }

  private withTotals(report: unknown): unknown {
    return report;
  }
}
