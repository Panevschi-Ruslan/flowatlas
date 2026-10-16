import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';

import { StockItem } from './stock-item.entity';
import { StockService } from './stock.service';

/**
 * No guard: the handler checks a signed header itself and refuses with a 401.
 * Expected: `route-checked-in-body`, at `info`, naming the throw.
 */
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly stock: StockService) {}

  @Post()
  receive(@Headers('x-signature') signature: string, @Body() item: StockItem): Promise<StockItem> {
    this.requireSignature(signature);
    return this.stock.save(item);
  }

  private requireSignature(signature: string | undefined): void {
    if (signature === undefined || signature.length === 0) throw new UnauthorizedException('signature required');
  }
}
