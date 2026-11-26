import { Controller, Param, Post } from '@nestjs/common';

import { DeskService } from './desk.service';

@Controller('api/desks')
export class DeskController {
  constructor(private readonly desks: DeskService) {}

  @Post(':id/help')
  help(@Param('id') id: string): void {
    this.desks.requestHelp(id, Number(id));
  }
}
