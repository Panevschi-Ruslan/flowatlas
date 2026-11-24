import { Body, Controller, Param, Post } from '@nestjs/common';
import { DeskService } from './desk.service';

@Controller('api/desks')
export class DeskController {
  constructor(private readonly desks: DeskService) {}

  @Post(':number/help')
  async help(@Param('number') deskNumber: string, @Body('note') note: string): Promise<void> {
    await this.desks.requestHelp(Number(deskNumber), note);
  }
}
