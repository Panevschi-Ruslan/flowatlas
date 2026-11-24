import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CreateOrderDto } from './dto';

@Injectable()
export class OrdersService {
  private readonly shipped = new Set<string>();
  private readonly known = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  async list(): Promise<string[]> {
    // A default, written out: nothing to set.
    const level = this.config.get('LOG_LEVEL', 'info');
    // The environment file sets `PAYMENTS_API_KEY`: one name spelled two ways.
    const key = this.config.get<string>('PAYMENT_API_KEY');
    return [level, key ?? ''];
  }

  async create(body: CreateOrderDto): Promise<string> {
    // Set nowhere, and read with no default.
    const cache = this.config.get<string>('REDIS_URL');
    // Set in the compose file.
    const mail = process.env.SMTP_HOST;
    // Goes on without it.
    const mode = process.env.ORDER_MODE ?? 'standard';
    return `${body.item}:${cache}:${mail}:${mode}`;
  }

  async cancel(id: string): Promise<void> {
    if (!this.known.has(id)) throw new NotFoundException(`no order ${id}`);
    if (this.shipped.has(id)) throw new ConflictException(`order ${id} has shipped`);
    this.known.delete(id);
  }

  async refund(id: string): Promise<void> {
    throw new HttpException(`order ${id} cannot be refunded`, this.statusFor(id));
  }

  async rename(id: string, title: string): Promise<void> {
    this.known.add(`${id}:${title}`);
  }

  async remove(id: string): Promise<void> {
    this.known.delete(id);
  }

  private statusFor(id: string): number {
    return id.length > 8 ? 422 : 409;
  }
}
