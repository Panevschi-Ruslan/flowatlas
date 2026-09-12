import { Injectable } from '@nestjs/common';
import { Cron, CronExpression, Interval, Timeout } from '@nestjs/schedule';

@Injectable()
export class TasksService {
  private ticks = 0;

  @Cron('*/5 * * * *')
  everyFiveMinutes(): void {
    this.ticks += 1;
  }

  @Cron(CronExpression.EVERY_HOUR)
  everyHour(): void {
    this.ticks += 1;
  }

  @Interval(5000)
  ticker(): void {
    this.ticks += 1;
  }

  @Timeout(1000)
  warmUp(): void {
    this.ticks = 0;
  }
}
