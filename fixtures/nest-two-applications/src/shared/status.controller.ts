import { Controller, Get } from '@nestjs/common';

/**
 * One controller, mounted in both applications, and therefore two addresses.
 *
 * This is a photo server's shape: a controller the application and a maintenance worker
 * both mount. It really is registered twice and really does answer in two
 * places, so it is two entries with one handler each — not one entry with two
 * handlers, which is the reading `routes.duplicated` is now free to mean.
 */
@Controller('status')
export class StatusController {
  @Get()
  status(): string {
    return 'ok';
  }
}
