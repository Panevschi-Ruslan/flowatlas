import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface ItemSeen {
  id: string;
  name: string;
  price: number;
}

/** The storefront's client of the catalog, through `CATALOG_URL`. */
@Injectable()
export class CatalogClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Sends the name and the price, never a currency. */
  async createItem(name: string, price: number): Promise<void> {
    await firstValueFrom(this.http.post(`${this.config.get('CATALOG_URL')}/items`, { name, price }));
  }

  /** Always sends a title. */
  async saveDraft(title: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.config.get('CATALOG_URL')}/drafts`, { title }));
  }

  async removeItem(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.config.get('CATALOG_URL')}/items/${id}`));
  }

  async getItem(id: string): Promise<ItemSeen> {
    const answer = await firstValueFrom(this.http.get<ItemSeen>(`${this.config.get('CATALOG_URL')}/items/${id}`));
    return answer.data;
  }
}
