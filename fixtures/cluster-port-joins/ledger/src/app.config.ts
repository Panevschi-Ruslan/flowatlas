import { registerAs } from '@nestjs/config';

/** Ledger's settings: the port falls back to 3013 where PORT is not set. */
export default registerAs('app', () => ({
  port: Number(process.env.PORT) || 3013,
}));
