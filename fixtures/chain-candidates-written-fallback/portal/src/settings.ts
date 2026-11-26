import { registerAs } from '@nestjs/config';

/** `orders.url` names no variable where it is read; this says it is `ORDERS_URL`. */
export const ordersSettings = registerAs('orders', () => ({
  url: process.env.ORDERS_URL,
}));

/** `legacy.url` is `LEGACY_URL`, which legacy and archive both claim. */
export const legacySettings = registerAs('legacy', () => ({
  url: process.env.LEGACY_URL,
}));
