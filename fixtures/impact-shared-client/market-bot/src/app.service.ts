import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The bot's client: `getActive` requests `GET /api/items` through `MARKET_API_URL`, `getDesks` another route. */
@Injectable()
export class AppService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getActive(shopId: string): Promise<string[]> {
    const response = await firstValueFrom(this.http.get<string[]>(`${this.config.get('MARKET_API_URL')}/api/items`, { params: { shopId } }));
    return response.data;
  }

  async getDesks(): Promise<string[]> {
    const response = await firstValueFrom(this.http.get<string[]>(`${this.config.get('MARKET_API_URL')}/api/staff/desks`));
    return response.data;
  }
}
