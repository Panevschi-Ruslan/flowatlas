import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { LoansService, type LoanRequest } from './loans.service';

@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Post()
  approve(@Body() request: LoanRequest): Promise<string> {
    return this.loans.approve(request);
  }

  @Get(':id/fee')
  fee(@Param('id') id: string): string {
    return this.loans.fee(id);
  }
}
