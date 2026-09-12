import { Inject, Injectable, forwardRef } from '@nestjs/common';

import { DiscountService } from './discount.service';

/**
 * One half of a `forwardRef` pair.
 *
 * A dependency cycle broken the way Nest asks it to be broken, which is why
 * `flowatlas cycles` leaves `injects` out until `--include-di` is passed: this
 * shape is idiomatic and would bury the cycles that are not.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(forwardRef(() => DiscountService))
    private readonly discounts: DiscountService,
  ) {}

  price(total: number): number {
    return total - this.discounts.rate();
  }
}
