import { All, Controller, Get, Version } from '@nestjs/common';

@Controller('catalog')
export class CatalogController {
  /** Array path: one entry per element, both handled by this method. */
  @Get(['a', 'b'])
  variants(): string[] {
    return ['a', 'b'];
  }

  /** @Version is typed as a MethodDecorator in @nestjs/common, so it sits on the handler. */
  @Get('detail')
  @Version('2')
  detail(): string {
    return 'detail-v2';
  }

  @All('*')
  fallback(): string {
    return 'fallback';
  }
}
