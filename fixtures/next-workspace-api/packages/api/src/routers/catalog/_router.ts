import { procedure, router } from '../../trpc';

export const catalogRouter = router({
  search: procedure.query(() => [{ sku: 'sku-1' }]),
});
