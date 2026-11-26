import { registerAs } from '@nestjs/config';

/** Where receipts are sent from, injected by its namespace's token. */
export const mailConfig = registerAs('mail', () => ({
  from: 'shop@example.com',
}));

/** Settings nothing loads: a token for them is provided by nothing. */
export const reportsConfig = registerAs('reports', () => ({
  every: 'day',
}));
