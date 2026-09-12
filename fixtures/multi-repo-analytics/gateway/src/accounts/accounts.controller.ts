import { Controller, Get, Param } from '@nestjs/common';

import { AccountsService } from './accounts.service';

/** Called by `orders` while it enriches an order. Half of the HTTP cycle. */
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get(':id')
  findOne(@Param('id') id: string): Promise<unknown> {
    return this.accounts.find(id);
  }
}
