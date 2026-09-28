import { Module } from '@nestjs/common';

import { SkillsController } from './skills/skills.controller';
import { SkillsService } from './skills/skills.service';

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
})
export class AppModule {}
