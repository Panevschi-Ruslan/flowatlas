import { Controller, Get } from '../framework/nest';

/** A controller reached through a barrel: not read, and reported by name. */
@Controller('legacy')
export class LegacyController {
  @Get('ping')
  ping(): string {
    return 'pong';
  }
}
