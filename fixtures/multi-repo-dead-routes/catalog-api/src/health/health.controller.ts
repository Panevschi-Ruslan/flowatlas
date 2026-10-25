import { Controller, Get } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';

/** What the platform asks the service about itself: nothing in the project calls either. */
@Controller()
export class HealthController {
  @Get('healthz')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready(): { status: string } {
    return { status: 'ok' };
  }
}
