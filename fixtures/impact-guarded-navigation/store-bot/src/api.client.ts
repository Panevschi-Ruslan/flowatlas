import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The bot's client: `getItems` requests `GET /api/shops/items` through `STORE_API_URL`. */
@Injectable()
export class ApiClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getItems(shopId: string): Promise<string[]> {
    const response = await firstValueFrom(this.http.get<string[]>(`${this.config.get('STORE_API_URL')}/api/shops/items`, { params: { shopId } }));
    return response.data;
  }
}
