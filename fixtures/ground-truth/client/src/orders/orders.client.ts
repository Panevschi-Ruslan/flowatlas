import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** One of the handful of names this project writes down for a report. */
const REPORT_PATHS: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
};

/** Every request this repository makes, all rooted at `API_URL`. */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** A verb that is neither GET nor POST, aimed at the route that answers it. */
  rename(id: string, name: string) {
    return this.http.patch(`${this.config.get('API_URL')}/orders/${id}`, { name });
  }

  /** A literal path that a catch-all also answers. The literal route is the one. */
  newest() {
    return this.http.get(`${this.config.get('API_URL')}/files/latest`);
  }

  /**
   * A segment chosen by a lookup rather than carried as a value. `api` does
   * serve `GET /reports/:kind`, and this call must still reach nothing: which
   * of the names the lookup holds is only known once the program runs.
   */
  report(kind: string) {
    return this.http.get(`${this.config.get('API_URL')}/reports/${REPORT_PATHS[kind]}`);
  }
}

// The request methods above declare no return type on purpose. What a request
// answers with is the library's business — `HttpService.get<T>` gives back
// `Observable<AxiosResponse<T>>` — and letting that signature decide is what
// makes this fixture a test of the library's shape rather than of a shape
// somebody retyped. They used to say `{ data: unknown }`, which no real Nest
// client can say and which hid the delivery wrapper the graph reads through.
//
// Do not put an annotation back. It would need two imports, and every line
// below them would move; node ids carry line numbers, and the fixture section
// of the repository README lists what that breaks.
