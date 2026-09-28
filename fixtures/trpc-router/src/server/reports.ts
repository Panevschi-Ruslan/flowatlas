import { adminProcedure } from './procedures';
import { router } from './trpc';

export const dailyTotals = () => [{ day: '2026-01-01', total: 12 }];

export const reportsRouter = router({
  daily: adminProcedure.query(dailyTotals),
});
