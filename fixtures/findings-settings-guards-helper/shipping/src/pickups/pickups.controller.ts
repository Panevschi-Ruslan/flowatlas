import { Controller, Delete, Param, Post, Put, UseGuards } from '@nestjs/common';

import { SkipStaffCheck, StaffGuard } from '../auth/staff.guard';

/** Pickups: guarded as a whole, one handler switching the guard off with no word that it is public. */
@UseGuards(StaffGuard)
@Controller('pickups')
export class PickupsController {
  private readonly booked = new Set<string>();

  @Post()
  book(): string {
    const id = String(this.booked.size + 1);
    this.booked.add(id);
    return id;
  }

  @Put(':id')
  move(@Param('id') id: string): string {
    return id;
  }

  @SkipStaffCheck()
  @Delete(':id')
  cancel(@Param('id') id: string): void {
    this.booked.delete(id);
  }
}
