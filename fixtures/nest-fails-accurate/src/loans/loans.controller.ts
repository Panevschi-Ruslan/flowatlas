import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { MemberGuard } from '../guards/member.guard';
import { StaffGuard } from '../guards/staff.guard';
import { CreateLoanDto } from './create-loan.dto';
import { LoansService } from './loans.service';
import { SearchQuery } from './search-query';

@Controller('loans')
@UseGuards(MemberGuard)
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  list() {
    return this.loans.list();
  }

  @Get('search')
  search(@Query() q: SearchQuery) {
    return this.loans.search(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.loans.findOne(id);
  }

  @Post()
  @UseGuards(StaffGuard)
  create(@Body() dto: CreateLoanDto) {
    return this.loans.create(dto);
  }

  @Get(':id/shelf')
  shelf(@Param('id') id: string) {
    return this.loans.shelf(id);
  }
}
