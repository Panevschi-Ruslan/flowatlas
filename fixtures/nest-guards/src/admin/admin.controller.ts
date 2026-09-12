import { Controller, Get } from '@nestjs/common';

/** Matched by the function middleware's `{ path: 'admin/*', method: RequestMethod.ALL }`. */
@Controller('admin')
export class AdminController {
  @Get('stats')
  stats(): number {
    return 0;
  }
}
