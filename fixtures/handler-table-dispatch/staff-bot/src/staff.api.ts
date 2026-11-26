import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface ActiveOrder {
  id: string;
  summary: string;
}

/** The staff bot's client of the shop's API, through `SHOP_API_URL`. */
@Injectable()
export class StaffApi {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getActiveOrders(): Promise<ActiveOrder[]> {
    const response = await firstValueFrom(this.http.get<ActiveOrder[]>(`${this.config.get('SHOP_API_URL')}/api/orders/active`));
    return response.data;
  }

  async setStatus(orderId: string, status: string): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.config.get('SHOP_API_URL')}/api/orders/status`, { orderId, status }));
  }

  async getStock(): Promise<{ items: number }> {
    const response = await firstValueFrom(this.http.get<{ items: number }>(`${this.config.get('SHOP_API_URL')}/api/stock`));
    return response.data;
  }
}
