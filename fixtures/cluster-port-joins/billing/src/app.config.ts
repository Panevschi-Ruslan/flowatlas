import { registerAs } from '@nestjs/config';

/** Billing's settings: the port falls back to 3012 where PORT is not set. */
export default registerAs('app', () => ({
  port: Number(process.env.PORT) || 3012,
}));
