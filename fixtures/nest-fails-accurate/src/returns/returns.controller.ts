import { Controller, Param, Post, UseFilters } from '@nestjs/common';

import { LoansService } from '../loans/loans.service';
import { FixedFilter } from './fixed.filter';

@Controller('returns')
@UseFilters(new FixedFilter())
export class ReturnsController {
  constructor(private readonly loans: LoansService) {}

  @Post(':id')
  giveBack(@Param('id') id: string) {
    return this.loans.shelf(id);
  }
}
