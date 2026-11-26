import { procedure, router } from '../../trpc';

export const ordersRouter = router({
  list: procedure.query(() => [{ id: 'o-1' }]),
  place: procedure.mutation(() => ({ id: 'o-2' })),
});
