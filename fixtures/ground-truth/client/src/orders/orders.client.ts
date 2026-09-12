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
  rename(id: string, name: string): { data: unknown } {
    return this.http.patch(`${this.config.get('API_URL')}/orders/${id}`, { name });
  }

  /** A literal path that a catch-all also answers. The literal route is the one. */
  newest(): { data: unknown } {
    return this.http.get(`${this.config.get('API_URL')}/files/latest`);
  }

  /**
   * A segment chosen by a lookup rather than carried as a value. `api` does
   * serve `GET /reports/:kind`, and this call must still reach nothing: which
   * of the names the lookup holds is only known once the program runs.
   */
  report(kind: string): { data: unknown } {
    return this.http.get(`${this.config.get('API_URL')}/reports/${REPORT_PATHS[kind]}`);
  }
}
