import { Controller, Get } from '@nestjs/common';

@Controller('office-rest/admin')
export class AdminController {
  @Get('users')
  users(): string[] {
    return [];
  }
}
