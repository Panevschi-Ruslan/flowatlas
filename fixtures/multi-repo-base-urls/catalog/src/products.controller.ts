import { Controller, Get } from '@nestjs/common';

@Controller('products')
export class ProductsController {
  /** Reached from the shop by `catalog.url`, which its settings factory falls back to `http://catalog:3002` for. */
  @Get()
  async list(): Promise<unknown> {
    // `ORDERS_FEED_URL` is `http://localhost:3001` in `wrangler.toml`: where orders runs locally.
    const latest = await fetch(`${process.env.ORDERS_FEED_URL}/orders/latest`);
    return latest.json();
  }
}
