import { Controller, Get } from '@nestjs/common';

/**
 * The file that used to disappear.
 *
 * `GET /health` is already claimed by the API's health controller, so before
 * R119 this emission landed on that entry's id, the builder kept the node it
 * already had, and this file contributed no node and no row — it read exactly
 * like a file with no routes in it. Every total stayed correct, which is why it
 * survived so long: the count of addresses was right, the count of handlers was
 * right, and what was missing was a file.
 */
@Controller('health')
export class WorkerHealthController {
  @Get()
  check(): string {
    return 'worker ok';
  }
}
