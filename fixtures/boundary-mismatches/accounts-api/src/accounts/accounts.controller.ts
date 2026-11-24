import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly config: ConfigService) {}

  /** Read with no default and set in no file; the schema may give it one. */
  @Get('me')
  me(): { name: string; session: string } {
    return { name: 'me', session: this.config.get<string>('SESSION_SECRET') };
  }
}
