import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { AdminApiService } from './admin-api.service';

@Injectable({ providedIn: 'root' })
export class DeskOrderService extends AdminApiService {
  protected resource(): string {
    return 'orders';
  }

  amendOrder(orderId: string, lines: string[]): Observable<number> {
    return this.post<number>(`${orderId}/modify`, { lines });
  }
}
