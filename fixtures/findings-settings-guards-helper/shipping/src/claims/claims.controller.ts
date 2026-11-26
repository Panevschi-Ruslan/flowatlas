import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { StaffGuard } from '../auth/staff.guard';

export interface Claim {
  id: string;
  parcelId: string;
  reason: string;
  notes: string[];
}

/** Claims made about a damaged or lost parcel: every write is staff-only but one. */
@Controller('claims')
export class ClaimsController {
  private readonly claims = new Map<string, Claim>();

  // A read left open beside guarded writes: often meant, never this kind.
  @Get()
  list(): Claim[] {
    return [...this.claims.values()];
  }

  @UseGuards(StaffGuard)
  @Post()
  create(@Body() body: { parcelId: string; reason: string }): Claim {
    const claim = { id: String(this.claims.size + 1), parcelId: body.parcelId, reason: body.reason, notes: [] };
    this.claims.set(claim.id, claim);
    return claim;
  }

  @UseGuards(StaffGuard)
  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: { text: string }): Claim | undefined {
    const claim = this.claims.get(id);
    claim?.notes.push(body.text);
    return claim;
  }

  // The one write with nothing in front of it.
  @Delete(':id')
  remove(@Param('id') id: string): void {
    this.claims.delete(id);
  }
}
