import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { Public, StaffGuard } from '../auth/staff.guard';

/** Parcels: staff change them; anyone may ask to track one, on purpose. */
@Controller('parcels')
export class ParcelsController {
  private readonly tracked = new Set<string>();

  @UseGuards(StaffGuard)
  @Post()
  create(@Body() body: { weight: number }): { weight: number } {
    return body;
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { weight: number }): { id: string; weight: number } {
    return { id, weight: body.weight };
  }

  // Open by a decision written on it: never the one left out.
  @Public()
  @Post(':id/track')
  track(@Param('id') id: string): void {
    this.tracked.add(id);
  }
}
