import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

/** Angular this package supplies to itself, so it is read as Angular. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  constructor(private readonly http: HttpClient) {}

  status(id: string) {
    return this.http.get<{ id: string; status: string }>(`/orders/${id}/status`);
  }
}
