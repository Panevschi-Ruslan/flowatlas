import { Controller, Get, Param } from '@nestjs/common';

/**
 * A catch-all beside a route that spells its segment out.
 *
 * Both answer `GET /files/latest`, and the spelled-out one is what the router
 * runs. A catch-all is not a segment the route spells out, so counting it as
 * one would hand the call to `*` and report the literal route as reached by
 * nobody.
 */
@Controller('files')
export class FilesController {
  @Get('latest')
  latest(): { name: string } {
    return { name: 'latest' };
  }

  @Get('*')
  any(@Param() params: Record<string, string>): { params: Record<string, string> } {
    return { params };
  }
}
