import { Body, Controller, Post } from '@nestjs/common';
import type { LedgerEntry } from '@shopkit/ledger';

import { ChargesService } from './charges.service';

@Controller('charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Post()
  create(@Body() body: { amount: number }): Promise<LedgerEntry> {
    return this.charges.create(body.amount);
  }
}
