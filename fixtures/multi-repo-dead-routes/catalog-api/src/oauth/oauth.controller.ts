import { Controller, Get, Query } from '@nestjs/common';

/** Where the identity provider sends the browser back to after sign-in. */
@Controller('oauth')
export class OAuthController {
  @Get('callback')
  callback(@Query('code') code: string): { code: string } {
    return { code };
  }
}
