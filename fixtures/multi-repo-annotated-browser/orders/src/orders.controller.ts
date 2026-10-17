import { Controller, Get } from '@nestjs/common';

/**
 * The orders service, which the storefront's `apiUrl` names. It also serves
 * `GET /items`, the order lines' items, so a request the storefront makes for
 * `/items` lands here unless something says otherwise.
 */
@Controller()
export class OrdersController {
  @Get('orders')
  list(): string[] {
    return [];
  }

  @Get('items')
  items(): string[] {
    return [];
  }
}
