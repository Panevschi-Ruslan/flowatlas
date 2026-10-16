import { Injectable } from '@nestjs/common';

import { TaxTable } from './index';
import type { DiscountRules } from './rules';

@Injectable()
export class PricingService {
  private readonly rules: DiscountRules = { apply: (_sku, amount) => amount };

  private readonly tax = new TaxTable();

  quote(sku: string, quantity: number): number {
    const gross = this.rules.apply(sku, quantity * 10);
    return this.tax.add(gross);
  }
}
