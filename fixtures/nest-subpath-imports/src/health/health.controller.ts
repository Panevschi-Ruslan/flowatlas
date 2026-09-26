import { Body, Controller, Get, Post } from '@nestjs/common/decorators';

/**
 * Every decorator on this class comes from a subpath of the package.
 *
 * `@nestjs/common/decorators` is a real entry point of `@nestjs/common`, and it
 * is how novu's `health.controller.ts` and two of its v2 controllers are
 * written. A reader matching the module specifier exactly finds no `@Controller`
 * here, passes over the class and writes nothing: the class and its methods are
 * in the graph, read by every other pass, with their routes missing and no row
 * anywhere to say so. Twenty-one of novu's routes were gone that way (R84).
 */
@Controller('health-check')
export class HealthController {
  @Get()
  check(): string {
    return 'ok';
  }

  @Get('ready')
  ready(): string {
    return 'ready';
  }

  @Post('idempotency')
  idempotency(@Body() body: unknown): unknown {
    return body;
  }
}
