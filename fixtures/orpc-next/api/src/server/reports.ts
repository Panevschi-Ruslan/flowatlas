import { os } from '@orpc/server';

export default {
  daily: os.handler(async () => [{ day: '2026-01-01', total: 12 }]),
};
