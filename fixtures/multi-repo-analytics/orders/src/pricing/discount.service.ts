import { Inject, Injectable, forwardRef } from '@nestjs/common';

import { PricingService } from './pricing.service';

/** The other half of the `forwardRef` pair. */
@Injectable()
export class DiscountService {
  constructor(
    @Inject(forwardRef(() => PricingService))
    private readonly pricing: PricingService,
  ) {}

  rate(): number {
    return 1;
  }
}
