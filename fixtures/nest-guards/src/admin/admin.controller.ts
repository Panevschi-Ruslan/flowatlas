import { Controller, Get } from '@nestjs/common';

import { StaffOnly } from '../decorators/staff-only.decorator';

/** Matched by the function middleware's `{ path: 'admin/*', method: RequestMethod.ALL }`. */
@Controller('admin')
export class AdminController {
  @Get('stats')
  stats(): number {
    return 0;
  }

  /** Guarded through `@StaffOnly`, which wraps `UseGuards(RolesGuard)` in `applyDecorators`. */
  @Get('audit')
  @StaffOnly('manager')
  audit(): number {
    return 0;
  }
}
