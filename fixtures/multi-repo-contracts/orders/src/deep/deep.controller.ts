import { Body, Controller, Post } from '@nestjs/common';

import { CategoryDto, DeepDto } from './deep.dto';

/** The two shapes a walk has to survive: a long one and one that contains itself. */
@Controller('deep')
export class DeepController {
  @Post()
  accept(@Body() body: DeepDto): Promise<void> {
    return Promise.resolve();
  }

  @Post('categories')
  categories(@Body() body: CategoryDto): Promise<void> {
    return Promise.resolve();
  }
}
