import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The storefront's client of the catalog, through `CATALOG_API_URL`. */
@Injectable()
export class CatalogClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async items(): Promise<string[]> {
    const response = await firstValueFrom(this.http.get<string[]>(`${this.config.get('CATALOG_API_URL')}/items`));
    return response.data;
  }

  async item(id: string): Promise<string> {
    const response = await firstValueFrom(this.http.get<string>(`${this.config.get('CATALOG_API_URL')}/items/${id}`));
    return response.data;
  }

  async archive(id: string, reason: string): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.config.get('CATALOG_API_URL')}/items/${id}/archive`, { reason }));
  }
}
