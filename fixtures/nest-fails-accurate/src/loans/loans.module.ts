import { Module } from '@nestjs/common';

import { MemberGuard } from '../guards/member.guard';
import { StaffGuard } from '../guards/staff.guard';
import { MembersService } from '../members/members.service';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  controllers: [LoansController],
  providers: [LoansService, MembersService, MemberGuard, StaffGuard],
  exports: [LoansService],
})
export class LoansModule {}
