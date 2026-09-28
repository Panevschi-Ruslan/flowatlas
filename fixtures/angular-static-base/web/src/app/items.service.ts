import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * A service that keeps its base address in a `static` field, which is how a
 * great many real ones are written and which used to read as no address at all.
 *
 * Two readings had to be fixed for anything here to join, and they are worth
 * telling apart because each was invisible on its own:
 *
 * - A `static` field is a property access on the identifier naming the class,
 *   not on `this`, and `this` was the only receiver anything looked for. The
 *   field was never opened (R103).
 * - `+` was not folded, so even opened the field held nothing. Two string
 *   literals added together were unreadable, which is what made it a bug rather
 *   than a limit: the checker itself gives no value for a `+`, whose type is the
 *   widened `string` however literal its operands (R102).
 *
 * A video platform declares 63 such fields, and between the two readings none of its 252
 * browser requests joined a route.
 */
@Injectable({ providedIn: 'root' })
export class ItemsService {
  /** The whole base address: the settings key, and the path it already wrote. */
  private static readonly BASE = environment.apiUrl + '/items';

  /** A piece of the path, from two literals the checker will not add up. */
  private static readonly PAY = '/items' + '/pay';

  /**
   * A base whose tail nobody can read.
   *
   * The discipline the template-literal path has always had: the half that can
   * be read is kept, and the half that cannot is a hole nothing matches. Reading
   * the readable half and dropping the rest would report this request against
   * `/items`, a route it may never reach, and call the edge `static`.
   */
  private static readonly OPAQUE = environment.apiUrl + globalThis.String(globalThis.Date.now());

  constructor(private readonly http: HttpClient) {}

  /**
   * The base out of the static field, and a parameter after it.
   *
   * Expected: `GET /items/:param`, rooted at `apiUrl`, joined to
   * `entry:api:http:GET:/items/:param`.
   */
  findOne(id: string): Observable<unknown> {
    return this.http.get<unknown>(`${ItemsService.BASE}/${id}`);
  }

  /**
   * The base written here and a segment read out of the static field.
   *
   * This is the half that needs the fold on its own: what is behind the field is
   * `'/items' + '/pay'`, and nothing but folding it gives the field a value.
   *
   * Expected: `POST /items/pay`, joined to `entry:api:http:POST:/items/pay`.
   */
  pay(): Observable<unknown> {
    return this.http.post<unknown>(`${environment.apiUrl}${ItemsService.PAY}`, {});
  }

  /**
   * The same shape with a `+` whose right half is decided at run time.
   *
   * Expected: the settings key is still named, because it was settled before
   * anything else, and the rest of the address is a hole. The request joins
   * nothing and is counted under `api-path-partly-read`.
   */
  list(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${ItemsService.OPAQUE}/items`);
  }

  /**
   * A `+` at the call site with nothing readable on either side.
   *
   * Expected: no address at all and one `api-path-dynamic` row. Half an address
   * is not an improvement on none, and this is the case that says so.
   */
  search(term: string): Observable<unknown[]> {
    return this.http.get<unknown[]>(term + globalThis.String(globalThis.Date.now()));
  }
}
