import { All, Controller, NotFoundException } from '@nestjs/common';

/**
 * A catch-all behind every specific route: `ALL /api/*`. A request a specific
 * route answers is not also a caller of this one, nor of what reaches it.
 */
@Controller('api')
export class FallbackController {
  @All('*')
  notFound(): never {
    throw new NotFoundException('no such route');
  }
}
