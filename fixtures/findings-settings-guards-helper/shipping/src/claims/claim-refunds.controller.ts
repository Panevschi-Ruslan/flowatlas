import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { StaffGuard } from '../auth/staff.guard';

/** Refunds paid against a claim: guarded as a whole, its delete included. */
@UseGuards(StaffGuard)
@Controller('claims/:claimId/refunds')
export class ClaimRefundsController {
  private readonly refunds = new Map<string, string[]>();

  @Get()
  list(@Param('claimId') claimId: string): string[] {
    return this.refunds.get(claimId) ?? [];
  }

  @Post()
  issue(@Param('claimId') claimId: string): string[] {
    const list = this.refunds.get(claimId) ?? [];
    list.push(String(list.length + 1));
    this.refunds.set(claimId, list);
    return list;
  }

  @Delete(':id')
  cancel(@Param('claimId') claimId: string, @Param('id') id: string): void {
    this.refunds.set(claimId, (this.refunds.get(claimId) ?? []).filter((each) => each !== id));
  }
}
