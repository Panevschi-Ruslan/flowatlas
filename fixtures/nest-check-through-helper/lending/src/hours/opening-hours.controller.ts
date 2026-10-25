import { Controller, Get } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { OpeningHour } from './opening-hour.entity';

/** @flowatlas-public opening hours are shown to anyone */
@Controller('opening-hours')
export class OpeningHoursController {
  constructor(
    @InjectRepository(OpeningHour)
    private readonly hours: Repository<OpeningHour>,
  ) {}

  @Get()
  list(): Promise<OpeningHour[]> {
    return this.hours.find();
  }

  @Get('today')
  today(): Promise<OpeningHour | null> {
    return this.hours.findOne({ where: { weekday: new Date().getDay() } });
  }
}
