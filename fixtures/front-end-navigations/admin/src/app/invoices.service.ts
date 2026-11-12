import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { tap } from 'rxjs';

/** The invoices service: hands back the whole answer, and its callers read the headers off it. */
@Injectable({ providedIn: 'root' })
export class InvoicesService {
  constructor(private readonly http: HttpClient) {}

  page(at: number) {
    return this.http.get<string[]>(`/api/invoices?page=${at}`, { observe: 'response' }).pipe(tap(() => undefined));
  }
}
