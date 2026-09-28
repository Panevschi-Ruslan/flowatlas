import { Controller, Get, Param } from '@nestjs/common';

import { SkillsService } from './skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get('token')
  token(): boolean {
    return this.skills.hasToken();
  }

  @Get(':owner/:repo')
  bundle(@Param('owner') owner: string, @Param('repo') repo: string): Promise<string> {
    return this.skills.bundle(`${owner}/${repo}`);
  }
}
