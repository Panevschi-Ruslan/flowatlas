import { Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { StaffGuard } from '../auth/staff.guard';

/** Depots: two writes open and one guarded, a pattern of its own rather than one left out. */
@Controller('depots')
export class DepotsController {
  private readonly depots = new Set<string>();

  @Post()
  open(): string {
    const id = String(this.depots.size + 1);
    this.depots.add(id);
    return id;
  }

  @Delete(':id')
  close(@Param('id') id: string): void {
    this.depots.delete(id);
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  rename(@Param('id') id: string): string {
    return id;
  }
}
