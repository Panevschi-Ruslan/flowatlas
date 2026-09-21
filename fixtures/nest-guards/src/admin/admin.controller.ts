import { Controller, Get } from '@nestjs/common';

import { StaffOnly } from '../decorators/staff-only.decorator';

/** Matched by the function middleware's `{ path: 'admin/*', method: RequestMethod.ALL }`. */
@Controller('admin')
export class AdminController {
  @Get('stats')
  stats(): number {
    return 0;
  }

  /**
   * A handler that checks the request in its own body, and says so.
   *
   * No guard sits in front of it and none should; the check is a signed header
   * resolved inside the method, which static reading cannot see. Expected:
   * `authNote` on the entry's meta, carrying the words after the annotation,
   * and no `route-unguarded` row from the audit (R33).
   *
   * @flowatlas-auth a signed header is resolved in the body and overrides the caller's claim
   */
  @Get('handover')
  handover(): number {
    return 0;
  }

  /** Guarded through `@StaffOnly`, which wraps `UseGuards(RolesGuard)` in `applyDecorators`. */
  @Get('audit')
  @StaffOnly('manager')
  audit(): number {
    return 0;
  }
}
