import { Controller, Get, Param } from '@nestjs/common';

/**
 * The route the lookup in `client` looks as though it reaches, and does not.
 *
 * A hole that picks one of the names the project writes down is not a value
 * filling this parameter, so a call whose segment comes from a lookup must not
 * be joined here (R01, R05).
 */
@Controller('reports')
export class ReportsController {
  @Get(':kind')
  ofKind(@Param('kind') kind: string): { kind: string } {
    return { kind };
  }
}
