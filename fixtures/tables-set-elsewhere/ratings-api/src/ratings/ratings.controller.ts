import { Controller, Get } from '@nestjs/common';
import { RatingsService } from './ratings.service.js';

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('best')
  best(): Promise<unknown> {
    return this.ratings.best();
  }

  @Get()
  all(): Promise<unknown> {
    return this.ratings.all();
  }

  @Get('recent')
  recent(): Promise<unknown> {
    return this.ratings.recent();
  }
}
