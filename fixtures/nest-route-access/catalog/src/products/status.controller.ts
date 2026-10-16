import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { ProductsService } from './products.service';

/** `@Public()` on the class opens every route of it: no row for `GET /status/size`. */
@Public()
@Controller('status')
export class StatusController {
  constructor(private readonly products: ProductsService) {}

  @Get('size')
  size(): Promise<number> {
    return this.products.count();
  }
}
