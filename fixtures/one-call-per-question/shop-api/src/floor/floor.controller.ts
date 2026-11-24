import { Body, Controller, Param, Post } from '@nestjs/common';
import { FloorService } from './floor.service';

@Controller('api/floor')
export class FloorController {
  constructor(private readonly floor: FloorService) {}

  @Post(':table/help')
  async help(@Param('table') table: string, @Body('note') note: string): Promise<void> {
    await this.floor.callStaff(Number(table), note);
  }
}
