import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * A request to a route the reading missed: the legacy service computes its
 * items controller's prefix, so `GET /items/:id` was never read. Held back,
 * never named a call to a missing route.
 */
@Injectable()
export class LegacyClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async item(id: string): Promise<unknown> {
    return (await firstValueFrom(this.http.get(`${this.config.get('LEGACY_API_URL')}/items/${id}`))).data;
  }
}
