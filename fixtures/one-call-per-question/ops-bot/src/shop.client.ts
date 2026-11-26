import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The bot's client of the shop, through `SHOP_API_URL`. */
@Injectable()
export class ShopClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async cancelOrder(orderId: string, userRef: string): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.config.get('SHOP_API_URL')}/api/orders/${orderId}/cancel`, { userRef }));
  }
}
