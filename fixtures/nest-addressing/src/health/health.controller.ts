import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

/**
 * A route that deliberately carries no version.
 *
 * `VERSION_NEUTRAL` is a symbol the framework exports, so there is nothing to
 * evaluate — and evaluating the options object as a whole made the one
 * unreadable property poison the readable one beside it, so this controller was
 * dropped entirely and reported as a computed path. It is not a path anybody
 * computed; it is `/api/.well-known/health`, with no version in it at all.
 */
@Controller({ path: '.well-known/health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  ping(): string {
    return 'ok';
  }
}
