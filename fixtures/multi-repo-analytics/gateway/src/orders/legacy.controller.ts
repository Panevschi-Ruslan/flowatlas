import { Controller, Get } from '@nestjs/common';

/**
 * Nothing calls this, in any repository.
 *
 * The row `flowatlas dead --kind entries` exists to produce, and the reason it is
 * only ever a heuristic: a route with no internal callers may still be a public
 * API somebody's cron job depends on.
 */
@Controller('internal')
export class LegacyController {
  @Get('legacy')
  legacy(): { ok: boolean } {
    return { ok: true };
  }
}
