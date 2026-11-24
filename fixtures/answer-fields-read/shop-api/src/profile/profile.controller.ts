import { Controller, Get } from '@nestjs/common';

/** What the profile answers: no `nickname`, which the app's card reads. */
export interface Profile {
  name: string;
  avatarUrl: string;
}

@Controller('profile')
export class ProfileController {
  @Get()
  me(): Profile {
    return { name: '', avatarUrl: '' };
  }
}
