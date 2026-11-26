import { Controller, Get } from '@nestjs/common';

/** Settings parsed from text: what the route answers is no declared shape, so a field read of it is not compared. */
@Controller('settings')
export class SettingsController {
  @Get()
  read() {
    return JSON.parse('{"theme":"dark"}');
  }
}
