import { Controller, Get } from '@nestjs/common';

/** The API's `/health`, reached from its root through one import. */
@Controller('health')
export class HealthController {
  @Get()
  check(): string {
    return 'api ok';
  }
}
