import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** A draft as the back office's form keeps it: every field may still be empty, and the tier is the label picked. */
export interface StoreDraft {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  city?: string;
  postcode?: string;
  openingHours?: string;
  priceTier: string;
}

/** The back office's client of the stores service, through `STORES_API_URL`. */
@Injectable()
export class StoresClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Seven fields the stores service requires and the draft may leave out, and a tier sent as text it reads as a number. */
  async create(draft: StoreDraft): Promise<unknown> {
    return (await firstValueFrom(this.http.post(`${this.config.get('STORES_API_URL')}/stores`, draft))).data;
  }
}
