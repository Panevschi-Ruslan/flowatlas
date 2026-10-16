import { Injectable } from '@nestjs/common';
import type { Receipt } from '@shopkit/mailer';

import { NotifyService } from '../notify/notify.service';
import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class OrdersService {
  /** Picked by name at run time: nothing static says which one runs. */
  private readonly steps: Record<string, (sku: string) => void> = {};

  constructor(
    private readonly notify: NotifyService,
    private readonly pricing: PricingService,
  ) {}

  async place(sku: string, quantity: number): Promise<Receipt> {
    const total = this.pricing.quote(sku, quantity);
    this.steps[sku](sku);
    return this.notify.confirm(sku, total);
  }

  async resend(id: string): Promise<Receipt> {
    return this.notify.confirm(id, 0);
  }
}
