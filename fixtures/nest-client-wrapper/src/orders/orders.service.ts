import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiClient } from '../api/api-client.js';

export interface Order {
  id: string;
  total: number;
}

@Injectable()
export class OrdersService {
  private readonly api: ApiClient;

  constructor(private readonly config: ConfigService) {
    const base = this.config.get<string>('ORDERS_URL') ?? '';
    const trimmed = base.replace(/\/+$/, '');
    this.api = new ApiClient(trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`);
  }

  async findOne(id: string): Promise<Order> {
    return this.api.get<Order>(`/orders/${id}`);
  }

  async create(order: Order): Promise<Order> {
    return this.api.post<Order>('/orders', order);
  }

  async cancel(id: string): Promise<Order> {
    return this.api.patch<Order>(`/orders/${id}/cancel`, { reason: 'customer' });
  }

  async search(term: string): Promise<Order[]> {
    return this.api.get<Order[]>(`/orders/search?term=${term}`);
  }
}
